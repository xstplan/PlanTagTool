from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote

from fastapi import File, Form, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from PIL import Image
import shutil


def register_dataset_routes(app: Any, ctx: Dict[str, Any]) -> None:
    STATIC_DIR = ctx["STATIC_DIR"]
    STATIC_ASSET_VERSION = ctx["STATIC_ASSET_VERSION"]
    PROJECTS_DIR = ctx["PROJECTS_DIR"]
    _active_images = ctx["_active_images"]
    _iter_project_images = ctx["_iter_project_images"]
    _normalize_project_name = ctx["_normalize_project_name"]
    _project_dir = ctx["_project_dir"]
    _find_image_path = ctx["_find_image_path"]
    _find_image_path_for_source = ctx["_find_image_path_for_source"]
    _ensure_thumb_image = ctx["_ensure_thumb_image"]
    _originals_dir = ctx["_originals_dir"]
    _generated_dir = ctx["_generated_dir"]
    _is_supported_image = ctx["_is_supported_image"]
    _ensure_unique_path = ctx["_ensure_unique_path"]
    _remove_thumb_cache_for_path = ctx["_remove_thumb_cache_for_path"]

    @app.get("/")
    async def root():
        html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
        html = html.replace("__ASSET_VERSION__", STATIC_ASSET_VERSION)
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})

    @app.get("/api/projects")
    async def list_projects():
        result = []
        for p in sorted(PROJECTS_DIR.iterdir(), key=lambda x: x.name.lower()):
            if p.is_dir():
                result.append({"name": p.name, "image_count": len(_active_images(p))})
        return result

    @app.post("/api/projects")
    async def create_project(name: str = Form(...)):
        clean = _normalize_project_name(name)
        project_dir = _project_dir(clean, must_exist=False)
        if project_dir.exists():
            raise ctx["HTTPException"](400, "Project already exists")
        project_dir.mkdir(parents=True)
        return {"name": clean, "image_count": 0}

    @app.put("/api/projects/{name}")
    async def rename_project(name: str, new_name: str = Form(...)):
        project_dir = _project_dir(name, must_exist=True)
        clean_new_name = _normalize_project_name(new_name)
        target_dir = _project_dir(clean_new_name, must_exist=False)

        if target_dir.resolve() == project_dir.resolve():
            return {"ok": True, "name": clean_new_name, "old_name": project_dir.name, "image_count": len(_active_images(project_dir))}
        if target_dir.exists():
            raise ctx["HTTPException"](400, "Project already exists")

        shutil.move(str(project_dir), str(target_dir))
        old_generated_dir = (target_dir / name).resolve()
        new_generated_dir = (target_dir / clean_new_name).resolve()
        if old_generated_dir.exists() and old_generated_dir.is_dir() and old_generated_dir != new_generated_dir:
            if not new_generated_dir.exists():
                shutil.move(str(old_generated_dir), str(new_generated_dir))
        return {"ok": True, "name": clean_new_name, "old_name": name, "image_count": len(_active_images(target_dir))}

    @app.delete("/api/projects/{name}")
    async def delete_project(name: str):
        project_dir = _project_dir(name, must_exist=True)
        shutil.rmtree(project_dir)
        return {"ok": True}

    @app.get("/api/projects/{name}/images")
    async def list_images(name: str, source: str = Query("active")):
        project_dir = _project_dir(name, must_exist=True)
        project_name = project_dir.name

        source_mode = (source or "active").strip().lower()
        if source_mode == "original":
            images_src = _iter_project_images(_originals_dir(project_dir))
            if not images_src:
                images_src = _iter_project_images(_generated_dir(project_dir))
        else:
            images_src = _active_images(project_dir)

        images = []
        for img_path in images_src:
            label_file = img_path.with_suffix(".txt")
            label = label_file.read_text(encoding="utf-8").strip() if label_file.exists() else ""
            stat = img_path.stat()
            try:
                with Image.open(img_path) as im:
                    w, h = im.size
            except Exception:
                w, h = 0, 0
            rel_path = img_path.relative_to(project_dir).as_posix()
            version = int(stat.st_mtime)
            images.append(
                {
                    "filename": img_path.name,
                    "width": w,
                    "height": h,
                    "labeled": label_file.exists() and bool(label),
                    "label": label,
                    "size": stat.st_size,
                    "url": f"/projects/{quote(project_name)}/{quote(rel_path, safe='/')}?v={version}",
                    "thumb_url": (
                        f"/api/projects/{quote(project_name)}/thumbnails/{quote(rel_path, safe='/')}"
                        f"?w=640&v={version}"
                    ),
                }
            )
        return images

    @app.get("/api/projects/{name}/thumbnails/{filepath:path}")
    async def image_thumbnail(
        name: str,
        filepath: str,
        w: int = Query(640, ge=64, le=2048),
        q: int = Query(82, ge=40, le=95),
    ):
        project_dir = _project_dir(name, must_exist=True)
        raw_path = (filepath or "").replace("\\", "/").lstrip("/")
        if "/" in raw_path:
            img_path = (project_dir / raw_path).resolve()
            try:
                img_path.relative_to(project_dir)
            except ValueError as exc:
                raise ctx["HTTPException"](400, "Invalid thumbnail path") from exc
            if not img_path.exists() or not _is_supported_image(img_path.name):
                raise ctx["HTTPException"](404, "Image not found")
        else:
            img_path = _find_image_path(project_dir, raw_path)
        thumb_path = _ensure_thumb_image(project_dir, img_path, w, q)
        return FileResponse(
            str(thumb_path),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=604800"},
        )

    @app.post("/api/projects/{name}/upload")
    async def upload_images(name: str, files: List[UploadFile] = File(...)):
        project_dir = _project_dir(name, must_exist=True)
        originals_dir = _originals_dir(project_dir)

        saved = []
        errors = []
        for file in files:
            if not file.filename:
                continue
            safe_name = Path(file.filename).name
            if not _is_supported_image(safe_name):
                errors.append(f"{safe_name}: unsupported format")
                continue

            dest = _ensure_unique_path(originals_dir, safe_name)
            content = await file.read()
            dest.write_bytes(content)
            saved.append(dest.name)

        return {"saved": saved, "errors": errors}

    @app.delete("/api/projects/{name}/images/{filename}")
    async def delete_image(name: str, filename: str, source: str = Query("auto")):
        project_dir = _project_dir(name, must_exist=True)
        img_path = _find_image_path_for_source(project_dir, filename, source)

        img_path.unlink()
        _remove_thumb_cache_for_path(project_dir, img_path)
        label_path = img_path.with_suffix(".txt")
        if label_path.exists():
            label_path.unlink()
        return {"ok": True}

    @app.put("/api/projects/{name}/labels/{filename}")
    async def update_label(name: str, filename: str, label: str = Form(...), source: str = Query("auto")):
        project_dir = _project_dir(name, must_exist=True)
        img_path = _find_image_path_for_source(project_dir, filename, source)
        label_path = img_path.with_suffix(".txt")
        label_path.write_text(label.strip(), encoding="utf-8")
        return {"ok": True}

    @app.delete("/api/projects/{name}/labels/{filename}")
    async def delete_label(name: str, filename: str, source: str = Query("auto")):
        project_dir = _project_dir(name, must_exist=True)
        img_path = _find_image_path_for_source(project_dir, filename, source)
        label_path = img_path.with_suffix(".txt")
        if label_path.exists():
            label_path.unlink()
        return {"ok": True}

    @app.delete("/api/projects/{name}/labels")
    async def clear_project_labels(name: str):
        project_dir = _project_dir(name, must_exist=True)
        deleted = 0
        for directory in (project_dir, _generated_dir(project_dir), _originals_dir(project_dir)):
            for label_path in directory.glob("*.txt"):
                if label_path.is_file():
                    label_path.unlink()
                    deleted += 1
        return {"ok": True, "deleted": deleted}
