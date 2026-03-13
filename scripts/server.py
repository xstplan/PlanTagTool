import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import functools
import hashlib
import os
import re
import shutil
import threading
import time
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from scripts.server_dataset import register_dataset_routes
from scripts.server_resize import register_resize_routes
from scripts.server_label import register_label_routes

app = FastAPI(title="LoRA Dataset Label Tool")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = (BASE_DIR / "static").resolve()
PROJECTS_DIR = (BASE_DIR / "projects").resolve()
PROJECTS_DIR.mkdir(exist_ok=True)

IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "gif"}
INVALID_PROJECT_CHARS = set(r'\/:*?"<>|')
LABEL_CANCEL_FLAGS: Dict[str, bool] = {}
THUMB_DIR_NAME = ".thumbs"
RESIZE_JOBS: Dict[str, Dict[str, Any]] = {}
RESIZE_JOBS_LOCK = threading.Lock()


# Helpers

def _normalize_project_name(name: str) -> str:
    clean = name.strip()
    if not clean or clean in {".", ".."} or any(c in clean for c in INVALID_PROJECT_CHARS):
        raise HTTPException(400, "Invalid project name")
    return clean


def _project_dir(name: str, must_exist: bool = True) -> Path:
    clean = _normalize_project_name(name)
    project_dir = (PROJECTS_DIR / clean).resolve()
    try:
        project_dir.relative_to(PROJECTS_DIR)
    except ValueError as exc:
        raise HTTPException(400, "Invalid project path") from exc
    if must_exist and not project_dir.is_dir():
        raise HTTPException(404, "Project not found")
    return project_dir


def _is_supported_image(filename: str) -> bool:
    ext = Path(filename).suffix.lower().lstrip(".")
    return ext in IMAGE_EXTS


def _safe_image_name(filename: str) -> str:
    safe_name = Path(filename).name
    if safe_name in {"", ".", ".."}:
        raise HTTPException(400, "Invalid filename")
    if not _is_supported_image(safe_name):
        raise HTTPException(400, "Unsupported image format")
    return safe_name


def _image_path(project_dir: Path, filename: str, must_exist: bool = True) -> Path:
    safe_name = _safe_image_name(filename)
    img_path = (project_dir / safe_name).resolve()
    try:
        img_path.relative_to(project_dir)
    except ValueError as exc:
        raise HTTPException(400, "Invalid image path") from exc
    if must_exist and not img_path.exists():
        raise HTTPException(404, "Image not found")
    return img_path


def _iter_project_images(project_dir: Path) -> List[Path]:
    return sorted(
        [p for p in project_dir.iterdir() if p.is_file() and _is_supported_image(p.name)],
        key=lambda p: (-p.stat().st_mtime, p.name.lower()),
    )


def _is_numbered_output_set(images: List[Path]) -> bool:
    if not images:
        return False
    return all(p.stem.isdigit() for p in images)


def _originals_dir(project_dir: Path) -> Path:
    d = (project_dir / "original").resolve()
    d.mkdir(exist_ok=True)
    return d


def _thumbs_dir(project_dir: Path) -> Path:
    d = (project_dir / THUMB_DIR_NAME).resolve()
    d.mkdir(exist_ok=True)
    return d


def _compute_static_asset_version(static_dir: Path) -> str:
    latest_mtime = 0
    for path in static_dir.rglob("*"):
        if not path.is_file():
            continue
        try:
            latest_mtime = max(latest_mtime, int(path.stat().st_mtime))
        except OSError:
            continue
    return str(latest_mtime or int(time.time()))


def _active_images(project_dir: Path) -> List[Path]:
    # Prefer resized outputs in project root; fallback to originals.
    root_images = _iter_project_images(project_dir)
    if root_images:
        if _is_numbered_output_set(root_images):
            return sorted(root_images, key=lambda p: p.name.lower())
        return root_images
    return _iter_project_images(_originals_dir(project_dir))


def _find_image_path(project_dir: Path, filename: str) -> Path:
    safe_name = _safe_image_name(filename)
    root_candidate = (project_dir / safe_name).resolve()
    originals_candidate = (_originals_dir(project_dir) / safe_name).resolve()

    try:
        root_candidate.relative_to(project_dir)
        originals_candidate.relative_to(project_dir)
    except ValueError as exc:
        raise HTTPException(400, "Invalid image path") from exc

    if root_candidate.exists():
        return root_candidate
    if originals_candidate.exists():
        return originals_candidate
    raise HTTPException(404, "Image not found")


def _thumb_cache_path(project_dir: Path, img_path: Path, width: int) -> Path:
    key = hashlib.md5(img_path.name.encode("utf-8")).hexdigest()[:12]
    return _thumbs_dir(project_dir) / f"{key}_{width}.jpg"


def _ensure_thumb_image(project_dir: Path, img_path: Path, width: int, quality: int = 82) -> Path:
    cache_path = _thumb_cache_path(project_dir, img_path, width)
    try:
        src_mtime = img_path.stat().st_mtime
    except Exception:
        src_mtime = 0

    if cache_path.exists():
        try:
            if cache_path.stat().st_mtime >= src_mtime:
                return cache_path
        except Exception:
            pass

    temp_path = cache_path.with_name(f".{cache_path.name}.{uuid4().hex}.tmp")
    try:
        with Image.open(img_path) as source_img:
            img = ImageOps.exif_transpose(source_img)
            if img.mode not in {"RGB", "L"}:
                img = img.convert("RGB")
            elif img.mode == "L":
                img = img.convert("RGB")

            max_edge = max(img.size) if img.size else 0
            if max_edge > width > 0:
                ratio = width / float(max_edge)
                new_w = max(1, int(img.width * ratio))
                new_h = max(1, int(img.height * ratio))
                img = img.resize((new_w, new_h), Image.LANCZOS)

            img.save(
                temp_path,
                format="JPEG",
                quality=max(40, min(95, quality)),
                optimize=True,
                progressive=True,
            )
        temp_path.replace(cache_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass

    return cache_path


def _remove_thumb_cache_for_name(project_dir: Path, filename: str) -> None:
    safe_name = _safe_image_name(filename)
    key = hashlib.md5(safe_name.encode("utf-8")).hexdigest()[:12]
    thumb_dir = _thumbs_dir(project_dir)
    for thumb_path in thumb_dir.glob(f"{key}_*.jpg"):
        if thumb_path.is_file():
            try:
                thumb_path.unlink()
            except Exception:
                pass


def _ensure_unique_path(directory: Path, filename: str) -> Path:
    base_name = Path(filename).name
    candidate = directory / base_name
    stem = candidate.stem or "image"
    suffix = candidate.suffix
    index = 1
    while candidate.exists():
        candidate = directory / f"{stem}_{index}{suffix}"
        index += 1
    return candidate


def _hex_to_rgb(hex_color: str) -> tuple:
    cleaned = hex_color.strip().lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", cleaned):
        return (255, 255, 255)
    return tuple(int(cleaned[i : i + 2], 16) for i in (0, 2, 4))


def _split_tags(text: str) -> List[str]:
    if not text:
        return []
    normalized = (
        text.replace("\n", ",")
        .replace("，", ",")
        .replace("；", ",")
        .replace(";", ",")
        .replace("|", ",")
    )
    return [part.strip() for part in normalized.split(",") if part.strip()]


def _clean_llm_response(raw: str) -> str:
    """Normalize model output into one-line comma-separated tags without heuristic filtering."""
    if not raw:
        return ""
    text = str(raw).strip()
    text = re.sub(r"```[^\n]*\n?", "", text)
    text = text.strip("`").strip()
    if len(text) >= 2 and text[0] in ('"', "'") and text[-1] == text[0]:
        text = text[1:-1].strip()
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)

    # Prefer explicit <tags>...</tags> block if model provides it.
    tag_block = re.search(r"<tags>(.*?)</tags>", text, flags=re.IGNORECASE | re.DOTALL)
    if tag_block:
        text = tag_block.group(1).strip()
    else:
        # For reasoning-style outputs, collect content after ":" on each line.
        line_candidates = []
        meta_keys = (
            "thinking process",
            "analyze",
            "request",
            "constraint",
            "task",
            "input",
            "draft",
            "filter",
            "refine",
            "prompt asks",
            "this means i should",
            "no sentence",
            "markdown",
            "bullet",
            "numbering",
        )
        for line in text.splitlines():
            ln = re.sub(r"^\s*[-*•]\s*", "", line).strip()
            ln = re.sub(r"^\s*\d+[.)]\s*", "", ln).strip()
            if not ln:
                continue
            ln_low = ln.lower()
            if any(key in ln_low for key in meta_keys):
                continue
            if ":" in ln:
                lhs, rhs = ln.split(":", 1)
                lhs_low = lhs.lower()
                if any(key in lhs_low for key in meta_keys):
                    continue
                rhs = rhs.strip()
                if rhs:
                    line_candidates.append(rhs)
            elif "," in ln:
                line_candidates.append(ln)
        if line_candidates:
            text = ", ".join(line_candidates)
        elif "thinking process" in text.lower():
            return ""

    parts = []
    seen = set()
    for tok in _split_tags(text):
        clean = re.sub(r"\s{2,}", " ", tok.strip(" \t\r\n,.;:|()[]{}\"'"))
        if not clean:
            continue
        if "`" in clean:
            continue
        low = clean.lower()
        if low in {"one line", "comma-separated", "comma separated", "lowercase", "english lowercase"}:
            continue
        if "prompt asks" in low or "this means i should" in low:
            continue
        if low.startswith(("do not ", "don't ", "output ", "tag ", "return ")):
            continue
        if low in seen:
            continue
        seen.add(low)
        parts.append(low)
    return ", ".join(parts)


def _merge_tags(*parts: str) -> str:
    seen = set()
    merged = []
    for part in parts:
        for tag in _split_tags(part):
            key = tag.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(tag)
    return ", ".join(merged)


def _cleanup_resize_jobs(now_ts: Optional[float] = None) -> None:
    now = now_ts if now_ts is not None else time.time()
    stale_ids = []
    with RESIZE_JOBS_LOCK:
        for job_id, data in RESIZE_JOBS.items():
            status = str(data.get("status", ""))
            updated_at = float(data.get("updated_at", 0.0) or 0.0)
            if status in {"completed", "failed"} and now - updated_at > 3600:
                stale_ids.append(job_id)
        for job_id in stale_ids:
            RESIZE_JOBS.pop(job_id, None)


def _set_resize_job(job_id: str, **kwargs: Any) -> None:
    with RESIZE_JOBS_LOCK:
        job = RESIZE_JOBS.get(job_id)
        if job is None:
            return
        job.update(kwargs)
        job["updated_at"] = time.time()


def _get_resize_job(job_id: str) -> Dict[str, Any]:
    with RESIZE_JOBS_LOCK:
        job = RESIZE_JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "Resize job not found")
        return dict(job)


async def _run_in_thread(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    to_thread = getattr(asyncio, "to_thread", None)
    if to_thread:
        return await to_thread(func, *args, **kwargs)
    loop = asyncio.get_running_loop()
    if kwargs:
        bound = functools.partial(func, *args, **kwargs)
        return await loop.run_in_executor(None, bound)
    return await loop.run_in_executor(None, func, *args)


# Static and routes

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/projects", StaticFiles(directory=str(PROJECTS_DIR)), name="projects")

_route_ctx = {
    "STATIC_DIR": STATIC_DIR,
    "STATIC_ASSET_VERSION": _compute_static_asset_version(STATIC_DIR),
    "PROJECTS_DIR": PROJECTS_DIR,
    "HTTPException": HTTPException,
    "RESIZE_JOBS": RESIZE_JOBS,
    "RESIZE_JOBS_LOCK": RESIZE_JOBS_LOCK,
    "LABEL_CANCEL_FLAGS": LABEL_CANCEL_FLAGS,
    "_normalize_project_name": _normalize_project_name,
    "_project_dir": _project_dir,
    "_is_supported_image": _is_supported_image,
    "_find_image_path": _find_image_path,
    "_active_images": _active_images,
    "_iter_project_images": _iter_project_images,
    "_originals_dir": _originals_dir,
    "_thumbs_dir": _thumbs_dir,
    "_ensure_unique_path": _ensure_unique_path,
    "_ensure_thumb_image": _ensure_thumb_image,
    "_remove_thumb_cache_for_name": _remove_thumb_cache_for_name,
    "_hex_to_rgb": _hex_to_rgb,
    "_cleanup_resize_jobs": _cleanup_resize_jobs,
    "_set_resize_job": _set_resize_job,
    "_get_resize_job": _get_resize_job,
    "_run_in_thread": _run_in_thread,
    "_clean_llm_response": _clean_llm_response,
    "_merge_tags": _merge_tags,
}

register_dataset_routes(app, _route_ctx)
register_resize_routes(app, _route_ctx)
register_label_routes(app, _route_ctx)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("scripts.server:app", host="0.0.0.0", port=8000, reload=True)

