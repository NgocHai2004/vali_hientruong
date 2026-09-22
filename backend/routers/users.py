import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from core.config import ADMIN_USERNAME, UPLOAD_DIR
from core.security import require_admin, hash_password
from schemas.auth import UserIn, UserPatch
import db.mongo as db_module

router = APIRouter(tags=["Users"])


def _serialize_user(u: dict) -> dict:
    return {
        "id": str(u["_id"]),
        "username": u["username"],
        "role": u.get("role", "user"),
        "full_name": u.get("full_name", ""),
        "avatar_url": u.get("avatar_url", "") or "",
        "created_at": u["created_at"].isoformat() if isinstance(u.get("created_at"), datetime) else None,
    }


@router.get("/api/users")
async def list_users(user: dict = Depends(require_admin)):
    return [_serialize_user(u) async for u in db_module.db.users.find({}).sort("username", 1)]


@router.post("/api/users")
async def create_user(body: UserIn, request: Request, admin: dict = Depends(require_admin)):
    if await db_module.db.users.find_one({"username": body.username}):
        raise HTTPException(400, "Tên tài khoản đã tồn tại")
    doc = {
        "username": body.username,
        "password_hash": hash_password(body.password),
        "role": body.role,
        "full_name": body.full_name or "",
        "created_at": datetime.utcnow(),
    }
    res = await db_module.db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    await db_module._log(request, admin, "create", "user", body.username, {"role": body.role})
    return _serialize_user(doc)


@router.patch("/api/users/{user_id}")
async def update_user(user_id: str, body: UserPatch, request: Request, admin: dict = Depends(require_admin)):
    target = await db_module.db.users.find_one({"_id": db_module._oid(user_id)})
    if not target:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    upd: dict = {}
    if body.password:
        upd["password_hash"] = hash_password(body.password)
    if body.role:
        if target["username"] == ADMIN_USERNAME and body.role != "admin":
            raise HTTPException(400, "Không thể hạ quyền tài khoản admin gốc")
        upd["role"] = body.role
    if body.full_name is not None:
        upd["full_name"] = body.full_name
    if not upd:
        return _serialize_user(target)
    doc = await db_module.db.users.find_one_and_update({"_id": db_module._oid(user_id)}, {"$set": upd}, return_document=True)
    await db_module._log(request, admin, "update", "user", doc["username"], {"fields": list(upd.keys())})
    return _serialize_user(doc)


@router.delete("/api/users/{user_id}")
async def delete_user(user_id: str, request: Request, admin: dict = Depends(require_admin)):
    target = await db_module.db.users.find_one({"_id": db_module._oid(user_id)})
    if not target:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    if target["username"] == ADMIN_USERNAME:
        raise HTTPException(400, "Không thể xoá tài khoản admin gốc")
    if target["username"] == admin["username"]:
        raise HTTPException(400, "Không thể xoá tài khoản của chính bạn")
    await db_module.db.users.delete_one({"_id": db_module._oid(user_id)})
    await db_module._log(request, admin, "delete", "user", target["username"])
    return {"ok": True}


@router.post("/api/users/{user_id}/avatar")
async def upload_user_avatar(user_id: str, file: UploadFile = File(...), request: Request = None, admin: dict = Depends(require_admin)):
    target = await db_module.db.users.find_one({"_id": db_module._oid(user_id)})
    if not target:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(400, "Chỉ hỗ trợ ảnh jpg/png/webp")
    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(400, "Ảnh vượt quá 3MB")
    avatars_dir = os.path.join(UPLOAD_DIR, "avatars")
    os.makedirs(avatars_dir, exist_ok=True)
    name = f"avatar_{target['username']}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{ext}"
    path = os.path.join(avatars_dir, name)
    with open(path, "wb") as f:
        f.write(data)
    avatar_url = f"/uploads/avatars/{name}"
    await db_module.db.users.update_one({"_id": db_module._oid(user_id)}, {"$set": {"avatar_url": avatar_url}})
    await db_module._log(request, admin, "update", "user", target["username"], {"action": "avatar"})
    return {"ok": True, "avatar_url": avatar_url}
