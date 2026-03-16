import asyncio
import base64
import io
import time
from typing import Any, Dict, Tuple
from uuid import uuid4

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel, Field


_FORMAT_RULE_EN = (
    "Return exactly one line of comma-separated tags in english lowercase. "
    "No sentence, no explanation, no markdown, no bullet list, no numbering, no colon, no key:value fields."
)

_FORMAT_RULE_ZH = (
    "Return exactly one line of comma-separated tags in simplified chinese. "
    "No sentence, no explanation, no markdown, no bullet list, no numbering, no colon, no key:value fields."
)

LABEL_PROMPT_BASES = {
    "character": (
        "Generate comma-separated LoRA training tags for a character or face-focused LoRA dataset image. "
        "Prioritize stable identity and face traits first, character count, gender cue tags, hairstyle, hair color, hair length, bangs, eye color, eye shape, "
        "face shape, eyebrows, lips, nose, visible facial marks, expression, head angle, and gaze direction. "
        "Use short plain tag phrases only. "
        "Only include clothing, accessories, pose, camera framing, lighting, or background when they are dominant, consistent, and important for the training target. "
        "For face-focused training, avoid weak or incidental outfit/background tags. "
        "Exclude subjective quality judgments, hidden details, interpretation, long descriptive phrases, and non-visual assumptions. "
    ),
    "object": (
        "Generate comma-separated LoRA training tags for an object-focused or product-focused dataset image. "
        "Tag the main subject only, category, material, color, shape, surface texture, structure, parts, condition, "
        "and printed text or logo on the object if visible. "
        "Exclude people, hands, body parts, scene, lighting style, camera terms, mood, and unrelated objects unless they are part of the subject itself. "
    ),
    "style": (
        "Generate comma-separated LoRA training tags for a style-focused dataset image. "
        "Output only plain reusable tag phrases, not labeled fields and not natural-language descriptions. "
        "Never use schema words or prefixes such as medium, style family, line quality, rendering technique, shading method, "
        "color palette, texture treatment, composition style, atmosphere, or any key:value form. "
        "Tag only learnable visual style traits such as photography medium, film look, cinematic lighting, soft focus, shallow depth of field, "
        "warm color grading, film grain, rim lighting, backlighting, bloom, bokeh, high contrast, low saturation, pastel tones, vintage tone, "
        "or painterly rendering when truly visible. "
        "Exclude concrete subject identity, clothing, pose, scene objects, body parts, and long descriptive phrases. "
    ),
    "scenery": (
        "Generate comma-separated LoRA training tags for scenery or background dataset images. "
        "Tag only environment attributes,indoor or outdoor type, location type, terrain, architecture, vegetation, weather, season, "
        "time of day, lighting condition, perspective, and atmosphere. "
        "Exclude people, clothing, and small incidental objects unless they are dominant visual elements. "
    ),
    "fashion": (
        "Generate comma-separated LoRA training tags for clothing-focused dataset images. "
        "Tag only garments and accessories themselves, garment type, silhouette, fit, sleeve or length, neckline, closure, "
        "fabric, material, pattern, color, trim, decoration, and style category. "
        "Exclude face, hair, body shape, pose, skin, background, lighting, and non-fashion objects. "
    ),
    "shoes": (
        "Generate LoRA training tags for footwear-focused concept training. "
        "Do not output shoe descriptors; tag non-footwear visible context only. "
    ),
    "general": (
        "Generate comma-separated LoRA training tags for a general LoRA dataset image. "
        "Tag only the main trainable visual features, primary subject, stable appearance traits, clothing or material, color scheme, "
        "pose or layout, and background elements only when visually important. "
        "Exclude subjective evaluations, long phrases, interpretation, and redundant context. "
    ),
    "custom": "",
}


def _normalize_language(value: str) -> str:
    lang = (value or "en").strip().lower()
    if lang in {"zh", "cn", "zh-cn", "chinese"}:
        return "zh"
    return "en"


def _format_rule(language: str) -> str:
    return _FORMAT_RULE_ZH if _normalize_language(language) == "zh" else _FORMAT_RULE_EN


def _build_mode_prompt(mode: str, language: str) -> str:
    base = LABEL_PROMPT_BASES.get(mode)
    if not base:
        return ""
    return base + _format_rule(language)


def _append_prompt_extra(prompt: str, extra_info: str) -> str:
    extra = (extra_info or "").strip()
    base_prompt = (prompt or "").strip()
    if extra and base_prompt:
        return f"{base_prompt}\n\n{extra}"
    return extra or base_prompt


class LabelSettings(BaseModel):
    lm_studio_url: str = "http://127.0.0.1:1234"
    model: str = ""
    mode: str = "general"
    prompt_extra_info: str = ""
    custom_prompt: str = ""
    prepend_tags: str = ""
    append_tags: str = ""
    max_tokens: int = Field(500, ge=16, le=4096)
    temperature: float = Field(0.2, ge=0.0, le=2.0)
    overwrite: bool = True
    skip_labeled: bool = False
    job_id: str = ""
    label_language: str = "en"


class TranslateTagsRequest(BaseModel):
    text: str = ""
    target_language: str = "zh"
    lm_studio_url: str = "http://127.0.0.1:1234"
    model: str = ""
    max_tokens: int = Field(300, ge=16, le=4096)
    temperature: float = Field(0.1, ge=0.0, le=2.0)


def register_label_routes(app: Any, ctx: Dict[str, Any]) -> None:
    _project_dir = ctx["_project_dir"]
    _active_images = ctx["_active_images"]
    _find_image_path = ctx["_find_image_path"]
    _clean_llm_response = ctx["_clean_llm_response"]
    _merge_tags = ctx["_merge_tags"]
    _cleanup_label_jobs = ctx["_cleanup_label_jobs"]
    _set_label_job = ctx["_set_label_job"]
    _get_label_job = ctx["_get_label_job"]
    _run_in_thread = ctx["_run_in_thread"]
    LABEL_CANCEL_FLAGS = ctx["LABEL_CANCEL_FLAGS"]
    LABEL_JOBS = ctx["LABEL_JOBS"]
    LABEL_JOBS_LOCK = ctx["LABEL_JOBS_LOCK"]
    HTTPException = ctx["HTTPException"]

    def _encode_image_for_lm(img_path: Any, fmt: str = "JPEG", max_edge: int = 0) -> Any:
        with Image.open(img_path) as source_img:
            img = ImageOps.exif_transpose(source_img)
            if img.mode != "RGB":
                img = img.convert("RGB")
            if max_edge > 0:
                edge = max(img.size)
                if edge > max_edge:
                    ratio = max_edge / float(edge)
                    new_size = (max(1, int(img.width * ratio)), max(1, int(img.height * ratio)))
                    img = img.resize(new_size, Image.LANCZOS)
            buffer = io.BytesIO()
            if fmt.upper() == "PNG":
                img.save(buffer, format="PNG")
                return base64.b64encode(buffer.getvalue()).decode(), "image/png"
            img.save(buffer, format="JPEG", quality=95)
            return base64.b64encode(buffer.getvalue()).decode(), "image/jpeg"

    def _resolve_prompt(settings: LabelSettings) -> Tuple[str, str]:
        label_language = _normalize_language(settings.label_language)

        if settings.mode == "custom":
            custom_prompt = settings.custom_prompt.strip()
            if not custom_prompt:
                raise HTTPException(400, "Custom prompt is required in custom mode")
            prompt = _append_prompt_extra(
                f"{custom_prompt} {_format_rule(label_language)}",
                settings.prompt_extra_info,
            )
        else:
            prompt = _append_prompt_extra(
                _build_mode_prompt(settings.mode, label_language),
                settings.prompt_extra_info,
            )
            if not prompt:
                raise HTTPException(400, "Unsupported label mode")

        return prompt, label_language

    async def _label_single_image(
        client: httpx.AsyncClient,
        img_path: Any,
        settings: LabelSettings,
        prompt: str,
        label_language: str,
        base_url: str,
    ) -> Dict[str, Any]:
        label_path = img_path.with_suffix(".txt")
        if label_path.exists() and (settings.skip_labeled or not settings.overwrite):
            existing = label_path.read_text(encoding="utf-8").strip()
            return {"file": img_path.name, "ok": True, "skipped": True, "label": existing}

        gen_max_tokens = max(64, min(int(settings.max_tokens), 1200))

        def build_payload(image_b64: str, image_mime: str) -> Dict[str, Any]:
            return {
                "model": settings.model or "local-model",
                "messages": [
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    "Return one single line of comma-separated tags only. "
                                    "No explanation, no markdown, no extra words. "
                                    + (
                                        "Use simplified chinese tags."
                                        if label_language == "zh"
                                        else "Use english lowercase tags."
                                    )
                                ),
                            },
                            {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{image_b64}"}},
                        ],
                    },
                ],
                "max_tokens": gen_max_tokens,
                "temperature": settings.temperature,
            }

        resp = None
        last_error = ""
        encode_plans = [("JPEG", 0), ("PNG", 0), ("PNG", 768)]
        for fmt, max_edge in encode_plans:
            image_b64, mime = _encode_image_for_lm(img_path, fmt, max_edge=max_edge)
            payload = build_payload(image_b64, mime)
            resp = await client.post(f"{base_url}/v1/chat/completions", json=payload)
            if resp.status_code < 400:
                break
            last_error = resp.text
            if "failed to process image" not in resp.text.lower():
                break

        if resp is None:
            raise RuntimeError("LM Studio request not sent")
        if resp.status_code >= 400:
            err_text = (resp.text or last_error or "")[:600]
            raise RuntimeError(f"LM Studio {resp.status_code}: {err_text}")

        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("LM Studio response has no choices")

        raw_label = str(choices[0].get("message", {}).get("content", "")).strip()
        raw_label = _clean_llm_response(raw_label)

        final_label = _merge_tags(settings.prepend_tags, raw_label, settings.append_tags)
        if not final_label.strip():
            fallback = _merge_tags(settings.prepend_tags, settings.append_tags)
            final_label = fallback.strip() or "untagged"

        label_path.write_text(final_label, encoding="utf-8")
        return {"file": img_path.name, "ok": True, "label": final_label}

    @app.post("/api/test-lmstudio")
    async def test_lmstudio(settings: LabelSettings):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{settings.lm_studio_url.rstrip('/')}/v1/models")
                resp.raise_for_status()
                data = resp.json()
                models = [m["id"] for m in data.get("data", []) if m.get("id")]
                return {"ok": True, "models": models}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @app.post("/api/label-jobs/{job_id}/cancel")
    async def cancel_label_job(job_id: str):
        clean_job_id = job_id.strip()
        if not clean_job_id:
            raise HTTPException(400, "Invalid job id")
        LABEL_CANCEL_FLAGS[clean_job_id] = True
        _set_label_job(clean_job_id, message="cancel_requested")
        return {"ok": True}

    @app.post("/api/translate-tags")
    async def translate_tags(req: TranslateTagsRequest):
        source_text = (req.text or "").strip()
        if not source_text:
            raise HTTPException(400, "No text to translate")

        target_lang = _normalize_language(req.target_language)
        target_desc = "simplified chinese" if target_lang == "zh" else "english lowercase"
        base_url = req.lm_studio_url.rstrip("/")
        max_tokens = max(64, min(int(req.max_tokens), 1200))

        prompt = (
            "You are a precise LoRA tag translator. "
            f"Translate the following comma-separated tags into {target_desc}. "
            "Keep tags concise and keep comma-separated tag format. "
            "Output only one line of comma-separated tags."
        )

        payload = {
            "model": req.model or "local-model",
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": source_text},
            ],
            "max_tokens": max_tokens,
            "temperature": req.temperature,
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{base_url}/v1/chat/completions", json=payload)
                if resp.status_code >= 400:
                    err_text = (resp.text or "")[:600]
                    raise RuntimeError(f"LM Studio {resp.status_code}: {err_text}")

                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    raise RuntimeError("LM Studio response has no choices")

                raw_text = str(choices[0].get("message", {}).get("content", "")).strip()
                translated = _clean_llm_response(raw_text)
                if not translated:
                    translated = source_text
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc

        return {"translated_text": translated, "language": target_lang}

    @app.post("/api/projects/{name}/label")
    async def label_images(name: str, settings: LabelSettings):
        project_dir = _project_dir(name, must_exist=True)
        images = _active_images(project_dir)
        if not images:
            return {"results": [], "message": "No images found", "canceled": False}
        prompt, label_language = _resolve_prompt(settings)

        job_id = settings.job_id.strip() or str(uuid4())
        LABEL_CANCEL_FLAGS[job_id] = False

        results = []
        canceled = False
        base_url = settings.lm_studio_url.rstrip("/")

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                for img_path in images:
                    if LABEL_CANCEL_FLAGS.get(job_id):
                        canceled = True
                        break

                    try:
                        result = await _label_single_image(
                            client=client,
                            img_path=img_path,
                            settings=settings,
                            prompt=prompt,
                            label_language=label_language,
                            base_url=base_url,
                        )
                        results.append(result)
                    except Exception as exc:
                        results.append({"file": img_path.name, "ok": False, "error": str(exc)})
        finally:
            LABEL_CANCEL_FLAGS.pop(job_id, None)

        return {"results": results, "job_id": job_id, "canceled": canceled}

    def _run_label_job_sync(job_id: str, project_name: str, settings: LabelSettings) -> None:
        async def runner() -> None:
            ok_count = 0
            fail_count = 0
            skipped_count = 0
            results = []
            canceled = False

            try:
                project_dir = _project_dir(project_name, must_exist=True)
                images = _active_images(project_dir)
                total = len(images)

                _set_label_job(
                    job_id,
                    status="running",
                    total=total,
                    done=0,
                    ok=0,
                    fail=0,
                    skipped=0,
                    progress=0,
                    current_file="",
                    message="processing",
                    results=[],
                    canceled=False,
                )

                if not images:
                    _set_label_job(
                        job_id,
                        status="completed",
                        total=0,
                        done=0,
                        ok=0,
                        fail=0,
                        skipped=0,
                        progress=100,
                        current_file="",
                        message="No images found",
                        results=[],
                        canceled=False,
                    )
                    return

                prompt, label_language = _resolve_prompt(settings)
                base_url = settings.lm_studio_url.rstrip("/")

                async with httpx.AsyncClient(timeout=120.0) as client:
                    for img_path in images:
                        if LABEL_CANCEL_FLAGS.get(job_id):
                            canceled = True
                            break

                        _set_label_job(job_id, current_file=img_path.name, message="processing")

                        try:
                            result = await _label_single_image(
                                client=client,
                                img_path=img_path,
                                settings=settings,
                                prompt=prompt,
                                label_language=label_language,
                                base_url=base_url,
                            )
                        except Exception as exc:
                            result = {"file": img_path.name, "ok": False, "error": str(exc)}

                        results.append(result)
                        if result.get("skipped"):
                            skipped_count += 1
                        elif result.get("ok"):
                            ok_count += 1
                        else:
                            fail_count += 1

                        done = len(results)
                        progress = int((done / total) * 100) if total > 0 else 100
                        _set_label_job(
                            job_id,
                            status="running",
                            total=total,
                            done=done,
                            ok=ok_count,
                            fail=fail_count,
                            skipped=skipped_count,
                            progress=progress,
                            current_file=img_path.name,
                            message="processing",
                            results=list(results),
                            canceled=False,
                        )

                final_status = "canceled" if canceled else "completed"
                final_message = "canceled" if canceled else "completed"
                _set_label_job(
                    job_id,
                    status=final_status,
                    total=total,
                    done=len(results),
                    ok=ok_count,
                    fail=fail_count,
                    skipped=skipped_count,
                    progress=(int((len(results) / total) * 100) if total > 0 else 100) if canceled else 100,
                    current_file="",
                    message=final_message,
                    results=list(results),
                    canceled=canceled,
                )
            except Exception as exc:
                _set_label_job(
                    job_id,
                    status="failed",
                    message=str(exc),
                    error=str(exc),
                    current_file="",
                )
            finally:
                LABEL_CANCEL_FLAGS.pop(job_id, None)

        asyncio.run(runner())

    async def _run_label_job(job_id: str, project_name: str, settings: LabelSettings) -> None:
        await _run_in_thread(_run_label_job_sync, job_id, project_name, settings)

    @app.post("/api/projects/{name}/label/start")
    async def start_label_job(name: str, settings: LabelSettings):
        _project_dir(name, must_exist=True)
        _cleanup_label_jobs()

        job_id = settings.job_id.strip() or str(uuid4())
        now = time.time()
        with LABEL_JOBS_LOCK:
            LABEL_JOBS[job_id] = {
                "job_id": job_id,
                "project": name,
                "status": "queued",
                "progress": 0,
                "total": 0,
                "done": 0,
                "ok": 0,
                "fail": 0,
                "skipped": 0,
                "current_file": "",
                "message": "queued",
                "error": "",
                "results": [],
                "canceled": False,
                "created_at": now,
                "updated_at": now,
            }

        LABEL_CANCEL_FLAGS[job_id] = False
        asyncio.create_task(_run_label_job(job_id, name, settings))
        return {"ok": True, "job_id": job_id}

    @app.get("/api/label-jobs/{job_id}")
    async def get_label_job(job_id: str):
        clean_job_id = job_id.strip()
        if not clean_job_id:
            raise HTTPException(400, "Invalid job id")
        _cleanup_label_jobs()
        return _get_label_job(clean_job_id)

    @app.post("/api/projects/{name}/label-single/{filename}")
    async def label_single(name: str, filename: str, settings: LabelSettings):
        project_dir = _project_dir(name, must_exist=True)
        img_path = _find_image_path(project_dir, filename)
        prompt, label_language = _resolve_prompt(settings)
        base_url = settings.lm_studio_url.rstrip("/")

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                result = await _label_single_image(
                    client=client,
                    img_path=img_path,
                    settings=settings,
                    prompt=prompt,
                    label_language=label_language,
                    base_url=base_url,
                )
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc

        return result
