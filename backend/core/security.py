from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
import bcrypt
from core.config import JWT_SECRET, JWT_ALGO, TOKEN_TTL_MINUTES
import db.mongo as db_module

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def make_token(username: str, role: str = "admin") -> str:
    payload = {
        "sub": username,
        "role": role,
        "exp": datetime.utcnow() + timedelta(minutes=TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    err = HTTPException(401, "Không có quyền truy cập", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        username = payload.get("sub")
        if not username:
            raise err
    except JWTError:
        raise err
    user = await db_module.db.users.find_one({"username": username})
    if not user:
        raise err
    return {
        "username": username,
        "role": user.get("role", "admin"),
        "full_name": user.get("full_name", "") or "",
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Chỉ tài khoản quản trị mới được thực hiện thao tác này")
    return user


def scope_filter(user: dict, base: dict = None) -> dict:
    filt = dict(base or {})
    if user.get("role") != "admin":
        filt["created_by"] = user["username"]
    return filt


def deny_admin_write(user: dict, verb: str) -> None:
    if user.get("role") == "admin":
        raise HTTPException(403, f"Tài khoản quản trị hệ thống chỉ xem vụ án, không {verb}.")
