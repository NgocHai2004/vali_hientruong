import os
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from bson import ObjectId
from core.storage import get_detainee_upload_dir, get_case_upload_dir
from core.security import get_current_user

router = APIRouter(tags=["Upload"])


@router.post("/api/upload/photo")
async def upload_photo(
    file: UploadFile = File(...),
    type: str = Query(default=""),
    category: Optional[str] = Query(default=None),
    detainee_id: Optional[str] = Query(default=None),
    case_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(400, "Chỉ hỗ trợ ảnh jpg/png/webp")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Ảnh vượt quá 10MB")

    cat = category or type or "portraits"
    name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{ObjectId()}{ext}"

    if case_id and cat in {"traces", "crops", "reports", "scene"}:
        fs_dir, url_prefix = get_case_upload_dir(case_id, sub_folder=cat)
    else:
        fs_dir, url_prefix = get_detainee_upload_dir(detainee_id, category=cat)

    path = os.path.join(fs_dir, name)
    with open(path, "wb") as f:
        f.write(data)

    return {
        "url": f"{url_prefix}/{name}",
        "size": len(data),
    }

