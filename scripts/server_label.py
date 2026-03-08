import base64
import io
from typing import Any, Dict
from uuid import uuid4

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel, Field


_FORMAT_RULE = (
    "Return exactly one line of comma-separated tags in english lowercase. "
    "No sentence, no explanation, no markdown, no bullet list, no numbering."
)

LABEL_PROMPTS = {
    "character": (
        "Generate LoRA training tags for character images. "
        "Tag visible character and scene details only. "
        + _FORMAT_RULE
    ),
    "object": (
        "Generate LoRA training tags for object and product images. "
        "Tag visible object details and useful context only. "
        + _FORMAT_RULE
    ),
    "style": (
        "Generate LoRA training tags for visual style. "
        "Tag medium, rendering, palette, composition, and mood style details. "
        + _FORMAT_RULE
    ),
    "scenery": (
        "Generate LoRA training tags for scenery and environment images. "
        "Tag visible environment and atmosphere details only. "
        + _FORMAT_RULE
    ),
    "fashion": (
        "Generate LoRA training tags for clothing and fashion. "
        "Tag garments and accessories only. "
        + _FORMAT_RULE
    ),
    "shoes": (
        "Generate LoRA training tags for footwear-focused concept training. "
        "Do not output shoe descriptors; tag non-footwear visible context only. "
        + _FORMAT_RULE
    ),
    "general": (
        "Generate LoRA training tags for mixed images. "
        "Tag visible content comprehensively. "
        + _FORMAT_RULE
    ),
    "custom": "",
}


class LabelSettings(BaseModel):
    lm_studio_url: str = "http://127.0.0.1:1234"
    model: str = ""
    mode: str = "general"
    custom_prompt: str = ""
    prepend_tags: str = ""
    append_tags: str = ""
    max_tokens: int = Field(500, ge=16, le=4096)
    temperature: float = Field(0.2, ge=0.0, le=2.0)
    overwrite: bool = True
    skip_labeled: bool = False
    job_id: str = ""


def register_label_routes(app: Any, ctx: Dict[str, Any]) -> None:
    _project_dir = ctx["_project_dir"]
    _active_images = ctx["_active_images"]
    _clean_llm_response = ctx["_clean_llm_response"]
    _merge_tags = ctx["_merge_tags"]
    LABEL_CANCEL_FLAGS = ctx["LABEL_CANCEL_FLAGS"]
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
        return {"ok": True}

    @app.post("/api/projects/{name}/label")
    async def label_images(name: str, settings: LabelSettings):
        project_dir = _project_dir(name, must_exist=True)
        images = _active_images(project_dir)
        if not images:
            return {"results": [], "message": "No images found", "canceled": False}

        if settings.mode == "custom":
            prompt = settings.custom_prompt.strip()
            if not prompt:
                raise HTTPException(400, "Custom prompt is required in custom mode")
        else:
            prompt = LABEL_PROMPTS.get(settings.mode)
            if not prompt:
                raise HTTPException(400, "Unsupported label mode")

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

                    label_path = img_path.with_suffix(".txt")
                    if label_path.exists() and (settings.skip_labeled or not settings.overwrite):
                        existing = label_path.read_text(encoding="utf-8").strip()
                        results.append({"file": img_path.name, "ok": True, "skipped": True, "label": existing})
                        continue

                    try:
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
                                                    "No explanation, no markdown, no extra words."
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
                            img_b64, mime = _encode_image_for_lm(img_path, fmt, max_edge=max_edge)
                            payload = build_payload(img_b64, mime)
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

                        # Model-direct output: keep generated tags and only merge user prefix/suffix.
                        final_label = _merge_tags(settings.prepend_tags, raw_label, settings.append_tags)
                        if not final_label.strip():
                            fallback = _merge_tags(settings.prepend_tags, settings.append_tags)
                            final_label = fallback.strip() or "untagged"

                        label_path.write_text(final_label, encoding="utf-8")
                        results.append({"file": img_path.name, "ok": True, "label": final_label})
                    except Exception as exc:
                        results.append({"file": img_path.name, "ok": False, "error": str(exc)})
        finally:
            LABEL_CANCEL_FLAGS.pop(job_id, None)

        return {"results": results, "job_id": job_id, "canceled": canceled}
