from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
import httpx

from core.config import FEATURE_USB_DONGLE
from core.security import (
    verify_password,
    make_token,
    get_current_user,
)
from schemas.auth import LoginResp, MePatch
import db.mongo as db_module

router = APIRouter(tags=["Auth"])


@router.get("/api/health")
async def health():
    try:
        await db_module.client.admin.command("ping")
        return {"ok": True, "db": "up"}
    except Exception as e:
        return {"ok": False, "db": "down", "error": str(e)}


@router.post("/api/auth/login", response_model=LoginResp)
async def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    user = await db_module.db.users.find_one({"username": form.username})
    if not user or not verify_password(form.password, user["password_hash"]):
        raise HTTPException(401, "Sai tài khoản hoặc mật khẩu")
    role = user.get("role", "admin")
    full_name = user.get("full_name", "") or ""
    await db_module._log(request, {"username": form.username}, "login", "auth")
    return LoginResp(
        access_token=make_token(form.username, role),
        username=form.username,
        role=role,
        full_name=full_name,
    )


@router.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.patch("/api/auth/me")
async def update_me(body: MePatch, request: Request, user: dict = Depends(get_current_user)):
    target = await db_module.db.users.find_one({"username": user["username"]})
    if not target:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    upd: dict = {}
    wants_name = body.full_name is not None
    wants_pw = bool(body.password)
    if not wants_name and not wants_pw:
        return {
            "username": user["username"],
            "role": user["role"],
            "full_name": target.get("full_name", "") or "",
        }
    if not body.current_password or not verify_password(body.current_password, target["password_hash"]):
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")
    if wants_name:
        upd["full_name"] = body.full_name.strip()
    if wants_pw:
        from core.security import hash_password
        upd["password_hash"] = hash_password(body.password)
    await db_module.db.users.update_one({"_id": target["_id"]}, {"$set": upd})
    await db_module._log(request, user, "update", "auth/me", user["username"], {"fields": list(upd.keys())})
    return {
        "username": user["username"],
        "role": user["role"],
        "full_name": upd.get("full_name", target.get("full_name", "") or ""),
    }


@router.get("/api/auth/dongle-verify")
async def dongle_verify(request: Request):
    if not FEATURE_USB_DONGLE:
        return {
            "verified": False,
            "feature_enabled": False,
            "error": "Tính năng USB Dongle đang tắt trên máy này (FEATURE_USB_DONGLE=0).",
        }
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get("http://127.0.0.1:8768/api/usb/verify")
        if resp.status_code == 200:
            data = resp.json()
            return {
                "verified": data.get("verified", False),
                "feature_enabled": True,
                "dongle_id": data.get("dongle_id"),
                "officer_name": data.get("officer_name", ""),
                "rank": data.get("rank", ""),
                "badge_number": data.get("badge_number", ""),
                "unit": data.get("unit", ""),
            }
        return {
            "verified": False,
            "feature_enabled": True,
            "error": resp.json().get("detail", "Dongle không hợp lệ"),
        }
    except Exception as e:
        return {
            "verified": False,
            "feature_enabled": True,
            "error": f"Không thể kết nối USB Service (port 8768): {e}",
        }
