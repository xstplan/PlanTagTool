from typing import Any, Dict, List

from pydantic import BaseModel, Field


def _split_tags(text: str) -> List[str]:
    if not text:
        return []
    normalized = (
        str(text)
        .replace("\n", ",")
        .replace("，", ",")
        .replace("；", ",")
        .replace(";", ",")
        .replace("|", ",")
    )
    result = []
    seen = set()
    for raw in normalized.split(","):
        tag = raw.strip()
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(tag)
    return result


def _join_tags(tags: List[str]) -> str:
    return ", ".join([tag for tag in tags if str(tag).strip()])


def _merge_prepend_tags(prepend_text: str, existing_text: str) -> str:
    merged = []
    seen = set()
    for source in (_split_tags(prepend_text), _split_tags(existing_text)):
        for tag in source:
            key = tag.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(tag)
    return _join_tags(merged)


def _remove_tags(existing_text: str, remove_text: str) -> str:
    remove_keys = {tag.lower() for tag in _split_tags(remove_text)}
    if not remove_keys:
        return _join_tags(_split_tags(existing_text))
    kept = [tag for tag in _split_tags(existing_text) if tag.lower() not in remove_keys]
    return _join_tags(kept)


class ManualBatchRequest(BaseModel):
    filenames: List[str] = Field(default_factory=list)
    tags: str = ""


def register_manual_routes(app: Any, ctx: Dict[str, Any]) -> None:
    _project_dir = ctx["_project_dir"]
    _find_image_path_for_source = ctx["_find_image_path_for_source"]
    HTTPException = ctx["HTTPException"]

    def _resolve_selected_images(project_name: str, filenames: List[str]) -> List[Any]:
        project_dir = _project_dir(project_name, must_exist=True)
        unique_names = []
        seen = set()
        for name in filenames or []:
            clean = str(name or "").strip()
            if not clean or clean in seen:
                continue
            seen.add(clean)
            unique_names.append(clean)
        if not unique_names:
            raise HTTPException(400, "No images selected")
        return [_find_image_path_for_source(project_dir, filename, "active") for filename in unique_names]

    @app.post("/api/projects/{name}/manual/batch-prepend")
    async def manual_batch_prepend(name: str, payload: ManualBatchRequest):
        if not payload.tags.strip():
            raise HTTPException(400, "No tags provided")

        images = _resolve_selected_images(name, payload.filenames)
        updated = []
        for img_path in images:
            label_path = img_path.with_suffix(".txt")
            existing = label_path.read_text(encoding="utf-8").strip() if label_path.exists() else ""
            merged = _merge_prepend_tags(payload.tags, existing)
            label_path.write_text(merged, encoding="utf-8")
            updated.append({"file": img_path.name, "label": merged})
        return {"ok": True, "updated": updated, "count": len(updated)}

    @app.post("/api/projects/{name}/manual/batch-remove-tags")
    async def manual_batch_remove_tags(name: str, payload: ManualBatchRequest):
        if not payload.tags.strip():
            raise HTTPException(400, "No tags provided")

        images = _resolve_selected_images(name, payload.filenames)
        updated = []
        for img_path in images:
            label_path = img_path.with_suffix(".txt")
            existing = label_path.read_text(encoding="utf-8").strip() if label_path.exists() else ""
            next_text = _remove_tags(existing, payload.tags)
            if next_text:
                label_path.write_text(next_text, encoding="utf-8")
            elif label_path.exists():
                label_path.unlink()
            updated.append({"file": img_path.name, "label": next_text})
        return {"ok": True, "updated": updated, "count": len(updated)}

    @app.post("/api/projects/{name}/manual/batch-clear-labels")
    async def manual_batch_clear_labels(name: str, payload: ManualBatchRequest):
        images = _resolve_selected_images(name, payload.filenames)
        cleared = 0
        for img_path in images:
            label_path = img_path.with_suffix(".txt")
            if label_path.exists():
                label_path.unlink()
                cleared += 1
        return {"ok": True, "count": len(images), "cleared": cleared}
