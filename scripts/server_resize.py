import asyncio
import os
import shutil
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

from fastapi import HTTPException
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask


class ResizeSettings(BaseModel):
    width: int = Field(..., ge=1, le=16384)
    height: int = Field(..., ge=1, le=16384)
    mode: str = "crop"  # crop | fit | stretch | pad
    output_format: str = "jpg"  # jpg | png | webp | original
    quality: int = Field(90, ge=1, le=100)
    pad_color: str = "#ffffff"
    overwrite: bool = False
    skip_existing: bool = False
    crop_focus_x: float = Field(0.5, ge=0.0, le=1.0)
    crop_focus_y: float = Field(0.5, ge=0.0, le=1.0)
    crop_focus_map: Dict[str, Dict[str, float]] = Field(default_factory=dict)


def register_resize_routes(app: Any, ctx: Dict[str, Any]) -> None:
    _project_dir = ctx["_project_dir"]
    _originals_dir = ctx["_originals_dir"]
    _iter_project_images = ctx["_iter_project_images"]
    _thumbs_dir = ctx["_thumbs_dir"]
    _ensure_unique_path = ctx["_ensure_unique_path"]
    _hex_to_rgb = ctx["_hex_to_rgb"]
    _run_in_thread = ctx["_run_in_thread"]
    _cleanup_resize_jobs = ctx["_cleanup_resize_jobs"]
    _set_resize_job = ctx["_set_resize_job"]
    _get_resize_job = ctx["_get_resize_job"]
    RESIZE_JOBS = ctx["RESIZE_JOBS"]
    RESIZE_JOBS_LOCK = ctx["RESIZE_JOBS_LOCK"]

    def _validate_resize_settings(settings: ResizeSettings) -> None:
        if settings.mode not in {"crop", "fit", "stretch", "pad"}:
            raise HTTPException(400, "Invalid resize mode")
        if settings.output_format not in {"jpg", "png", "webp", "original"}:
            raise HTTPException(400, "Invalid output format")

    def _prepare_source_images(project_dir: Path) -> List[Path]:
        originals_dir = _originals_dir(project_dir)
        source_images = _iter_project_images(originals_dir)

        # Backward compatibility: if originals dir is empty, migrate current root images as originals.
        if not source_images:
            migrated = _iter_project_images(project_dir)
            for img_path in migrated:
                dest = _ensure_unique_path(originals_dir, img_path.name)
                shutil.move(str(img_path), str(dest))
                src_label = img_path.with_suffix(".txt")
                if src_label.exists():
                    dst_label = dest.with_suffix(".txt")
                    shutil.move(str(src_label), str(dst_label))
            source_images = _iter_project_images(originals_dir)

        return source_images

    def _get_output_ext(source_img: Image.Image, img_path: Path, output_format: str) -> str:
        fmt_out = output_format
        if fmt_out == "original":
            fmt_out = source_img.format.lower() if source_img.format else img_path.suffix.lower().lstrip(".")
            if fmt_out == "jpeg":
                fmt_out = "jpg"
        return {"jpg": "jpg", "jpeg": "jpg", "png": "png", "webp": "webp"}.get(fmt_out, "jpg")

    def _find_existing_output_variant(project_dir: Path, index: int) -> Optional[Path]:
        stem = f"{index + 1:04d}"
        for candidate in sorted(project_dir.glob(f"{stem}.*")):
            if candidate.is_file() and candidate.suffix.lower().lstrip(".") in {"jpg", "jpeg", "png", "webp", "bmp", "gif"}:
                return candidate
        return None

    def _remove_output_variants_for_index(project_dir: Path, index: int, keep_name: str = "") -> None:
        stem = f"{index + 1:04d}"
        for candidate in project_dir.glob(f"{stem}.*"):
            if not candidate.is_file():
                continue
            if candidate.suffix.lower().lstrip(".") not in {"jpg", "jpeg", "png", "webp", "bmp", "gif"}:
                continue
            if keep_name and candidate.name == keep_name:
                continue
            try:
                candidate.unlink()
            except FileNotFoundError:
                pass

    def _read_image_size(img_path: Path) -> str:
        try:
            with Image.open(img_path) as existing_img:
                w, h = existing_img.size
                return f"{w}x{h}"
        except Exception:
            return ""

    def _process_resize_one(project_dir: Path, index: int, img_path: Path, settings: ResizeSettings) -> Dict[str, Any]:
        with Image.open(img_path) as source_img:
            img = ImageOps.exif_transpose(source_img)

            with Image.open(img_path) as format_probe:
                out_ext = _get_output_ext(format_probe, img_path, settings.output_format)

            existing_variant = _find_existing_output_variant(project_dir, index)
            if settings.skip_existing and existing_variant and existing_variant.exists():
                return {
                    "file": img_path.name,
                    "output": existing_variant.name,
                    "ok": True,
                    "skipped": True,
                    "size": _read_image_size(existing_variant),
                }

            target_mode = "RGBA" if out_ext == "png" else "RGB"
            if img.mode != target_mode:
                img = img.convert(target_mode)

            tw, th = settings.width, settings.height

            if settings.mode == "crop":
                focus_x = settings.crop_focus_x
                focus_y = settings.crop_focus_y
                zoom = 1.0
                per_file_focus = settings.crop_focus_map.get(img_path.name)
                if isinstance(per_file_focus, dict):
                    try:
                        focus_x = max(0.0, min(1.0, float(per_file_focus.get("x", focus_x))))
                        focus_y = max(0.0, min(1.0, float(per_file_focus.get("y", focus_y))))
                        zoom = max(1.0, min(8.0, float(per_file_focus.get("zoom", zoom))))
                    except Exception:
                        focus_x = settings.crop_focus_x
                        focus_y = settings.crop_focus_y
                        zoom = 1.0

                ratio = max(tw / img.width, th / img.height) * zoom
                nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
                img = img.resize((nw, nh), Image.LANCZOS)
                left = int((nw - tw) * focus_x)
                top = int((nh - th) * focus_y)
                left = max(0, min(left, nw - tw))
                top = max(0, min(top, nh - th))
                img = img.crop((left, top, left + tw, top + th))
            elif settings.mode == "fit":
                ratio = min(tw / img.width, th / img.height)
                nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
                img = img.resize((nw, nh), Image.LANCZOS)
            elif settings.mode == "stretch":
                img = img.resize((tw, th), Image.LANCZOS)
            elif settings.mode == "pad":
                ratio = min(tw / img.width, th / img.height)
                nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
                resized = img.resize((nw, nh), Image.LANCZOS)
                pad_rgb = _hex_to_rgb(settings.pad_color)
                canvas = Image.new(target_mode, (tw, th), pad_rgb if target_mode == "RGB" else (*pad_rgb, 255))
                x = (tw - nw) // 2
                y = (th - nh) // 2
                canvas.paste(resized, (x, y))
                img = canvas

            out_path = project_dir / f"{index + 1:04d}.{out_ext}"
            _remove_output_variants_for_index(project_dir, index, keep_name=out_path.name)

            save_kw = {}
            pil_fmt = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP"}[out_ext]
            if pil_fmt in {"JPEG", "WEBP"}:
                save_kw["quality"] = settings.quality
            if pil_fmt == "JPEG":
                if img.mode != "RGB":
                    img = img.convert("RGB")
                save_kw["optimize"] = False
            elif pil_fmt == "PNG":
                save_kw["compress_level"] = 1
            elif pil_fmt == "WEBP":
                save_kw["method"] = 0

            img.save(out_path, format=pil_fmt, **save_kw)

        return {
            "file": img_path.name,
            "output": out_path.name,
            "ok": True,
            "size": f"{settings.width}x{settings.height}" if settings.mode == "stretch" else _read_image_size(out_path),
        }

    def _process_resize_images(
        project_dir: Path,
        settings: ResizeSettings,
        on_progress: Optional[Callable[[int, int, Optional[Dict[str, Any]]], None]] = None,
    ) -> List[Dict[str, Any]]:
        _validate_resize_settings(settings)
        source_images = _prepare_source_images(project_dir)

        if not source_images:
            if on_progress:
                on_progress(0, 0, None)
            return []

        # Clear cached thumbnails; resized outputs will be regenerated.
        shutil.rmtree(_thumbs_dir(project_dir), ignore_errors=True)
        _thumbs_dir(project_dir)

        if not settings.skip_existing:
            # Regenerate modified images from originals each run unless user explicitly keeps existing outputs.
            for old_img in _iter_project_images(project_dir):
                old_img.unlink()
            for old_label in project_dir.glob("*.txt"):
                if old_label.is_file():
                    old_label.unlink()

        total = len(source_images)
        if on_progress:
            on_progress(0, total, None)

        def process_one(item: Any) -> Any:
            index, img_path = item
            try:
                result_item = _process_resize_one(project_dir, index, img_path, settings)
            except Exception as exc:
                result_item = {"file": img_path.name, "ok": False, "error": str(exc)}
            return index, result_item

        items = list(enumerate(source_images))
        results_by_index: List[Optional[Dict[str, Any]]] = [None] * total
        done = 0
        max_workers = min(8, max(1, os.cpu_count() or 4), total)

        if max_workers <= 1:
            for item in items:
                idx, result_item = process_one(item)
                results_by_index[idx] = result_item
                done += 1
                if on_progress:
                    on_progress(done, total, result_item)
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = [pool.submit(process_one, item) for item in items]
                for future in as_completed(futures):
                    idx, result_item = future.result()
                    results_by_index[idx] = result_item
                    done += 1
                    if on_progress:
                        on_progress(done, total, result_item)

        return [r for r in results_by_index if r is not None]

    def _run_resize_job_sync(job_id: str, project_name: str, settings: ResizeSettings) -> None:
        ok_count = 0
        fail_count = 0

        def report(done: int, total: int, result: Optional[Dict[str, Any]]) -> None:
            nonlocal ok_count, fail_count
            if result:
                if result.get("ok"):
                    ok_count += 1
                else:
                    fail_count += 1
            progress = int((done / total) * 100) if total > 0 else 0
            _set_resize_job(
                job_id,
                status="running",
                total=total,
                done=done,
                ok=ok_count,
                fail=fail_count,
                progress=progress,
                current_file=(result or {}).get("file", ""),
            )

        try:
            project_dir = _project_dir(project_name, must_exist=True)
            _set_resize_job(job_id, status="running", message="processing")
            results = _process_resize_images(project_dir, settings, report)
            _set_resize_job(
                job_id,
                status="completed",
                done=len(results),
                total=len(results),
                ok=sum(1 for r in results if r.get("ok")),
                fail=sum(1 for r in results if not r.get("ok")),
                progress=100,
                results=results,
                message="completed",
            )
        except Exception as exc:
            _set_resize_job(
                job_id,
                status="failed",
                message=str(exc),
                error=str(exc),
            )

    async def _run_resize_job(job_id: str, project_name: str, settings: ResizeSettings) -> None:
        await _run_in_thread(_run_resize_job_sync, job_id, project_name, settings)

    @app.post("/api/projects/{name}/resize")
    async def resize_images(name: str, settings: ResizeSettings):
        project_dir = _project_dir(name, must_exist=True)
        _validate_resize_settings(settings)
        results = await _run_in_thread(_process_resize_images, project_dir, settings, None)
        return {"results": results}

    @app.post("/api/projects/{name}/resize-single/{filename}")
    async def resize_single_image(name: str, filename: str, settings: ResizeSettings):
        project_dir = _project_dir(name, must_exist=True)
        _validate_resize_settings(settings)
        source_images = _prepare_source_images(project_dir)
        if not source_images:
            raise HTTPException(404, "No source images found")

        matched_index = -1
        matched_path: Optional[Path] = None
        for index, img_path in enumerate(source_images):
            if img_path.name == filename:
                matched_index = index
                matched_path = img_path
                break

        if matched_path is None:
            raise HTTPException(404, "Image not found")

        shutil.rmtree(_thumbs_dir(project_dir), ignore_errors=True)
        _thumbs_dir(project_dir)
        result = await _run_in_thread(_process_resize_one, project_dir, matched_index, matched_path, settings)
        return result

    @app.post("/api/projects/{name}/resize/start")
    async def start_resize_job(name: str, settings: ResizeSettings):
        _project_dir(name, must_exist=True)
        _validate_resize_settings(settings)
        _cleanup_resize_jobs()

        job_id = str(uuid4())
        now = time.time()
        with RESIZE_JOBS_LOCK:
            RESIZE_JOBS[job_id] = {
                "job_id": job_id,
                "project": name,
                "status": "queued",
                "progress": 0,
                "total": 0,
                "done": 0,
                "ok": 0,
                "fail": 0,
                "current_file": "",
                "message": "queued",
                "error": "",
                "results": [],
                "created_at": now,
                "updated_at": now,
            }

        asyncio.create_task(_run_resize_job(job_id, name, settings))
        return {"ok": True, "job_id": job_id}

    @app.get("/api/resize-jobs/{job_id}")
    async def get_resize_job(job_id: str):
        clean_job_id = job_id.strip()
        if not clean_job_id:
            raise HTTPException(400, "Invalid job id")
        _cleanup_resize_jobs()
        return _get_resize_job(clean_job_id)

    @app.get("/api/projects/{name}/resize/export")
    async def export_resize_results(name: str):
        project_dir = _project_dir(name, must_exist=True)
        output_images = _iter_project_images(project_dir)
        if not output_images:
            raise HTTPException(404, "No resized output images to export")

        temp_dir = Path(tempfile.mkdtemp(prefix="planlabel_export_"))
        zip_filename = f"{project_dir.name}_resize_results.zip"
        zip_path = temp_dir / zip_filename

        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for img_path in sorted(output_images, key=lambda p: p.name):
                zf.write(img_path, arcname=img_path.name)
            for txt_path in sorted(project_dir.glob("*.txt"), key=lambda p: p.name):
                if txt_path.is_file():
                    zf.write(txt_path, arcname=txt_path.name)

        return FileResponse(
            str(zip_path),
            media_type="application/zip",
            filename=zip_filename,
            background=BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True)),
        )
