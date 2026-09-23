from __future__ import annotations
import os
from datetime import datetime
from typing import Optional, List
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from core.config import (
    MONGO_URL,
    DB_NAME,
    ADMIN_USERNAME,
    ADMIN_PASSWORD,
    UPLOAD_DIR,
    SCENE_UPLOAD_DIR,
)

client: Optional[AsyncIOMotorClient] = None
db = None


def init_db():
    global client, db
    client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=3000)
    db = client[DB_NAME]
    return client, db


def close_db():
    global client
    if client:
        client.close()


def _oid(s: str) -> ObjectId:
    try:
        return ObjectId(s)
    except Exception:
        raise HTTPException(400, "invalid id")


def _s(doc: dict) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc.pop("_id"))
    if "case_id" in doc and doc["case_id"] is not None:
        doc["case_id"] = str(doc["case_id"])
    for k in ("created_at", "updated_at", "dob"):
        if k in doc and isinstance(doc[k], datetime):
            doc[k] = doc[k].isoformat()
    return doc


def _s_case(doc: dict) -> dict:
    if not doc:
        return doc
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    for k in ("occurred_at", "created_at", "closed_at", "updated_at"):
        v = out.get(k)
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    return out


def _s_scene(doc: dict) -> dict:
    if not doc:
        return doc
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    out["case_id"] = str(out.get("case_id") or "")
    for k in ("created_at", "captured_at"):
        v = out.get(k)
        if isinstance(v, datetime):
            out[k] = v.isoformat()
    out.pop("face_embedding", None)
    return out


def _s_match(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    for k in ("case_id", "trace_id", "detainee_id"):
        if out.get(k) is not None:
            out[k] = str(out[k])
    if isinstance(out.get("created_at"), datetime):
        out["created_at"] = out["created_at"].isoformat()
    return out


def _case_id_query(case_doc_or_id):
    if isinstance(case_doc_or_id, dict):
        cid = case_doc_or_id.get("_id")
    else:
        cid = case_doc_or_id
    if not cid:
        return {}
    oids = []
    if isinstance(cid, ObjectId):
        oids = [cid, str(cid)]
    else:
        oids = [cid]
        try:
            oids.append(ObjectId(str(cid)))
        except Exception:
            pass
    return {"$in": oids}


def _resolve_upload_path(url: str) -> str | None:
    if not url or not url.startswith("/uploads/"):
        return None
    rel = url[len("/uploads/"):]
    path = os.path.join(UPLOAD_DIR, rel.replace("/", os.sep))
    return path if os.path.isfile(path) else None


def _delete_scene_file(url: Optional[str]) -> None:
    if not url:
        return
    path = _resolve_upload_path(url)
    if path and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _parse_dob(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    return None


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


async def _ensure_admin():
    from core.security import hash_password
    existing = await db.users.find_one({"username": ADMIN_USERNAME})
    if not existing:
        await db.users.insert_one({
            "username": ADMIN_USERNAME,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "full_name": "Nguyễn Tuấn Anh",
            "created_at": datetime.utcnow(),
        })
    else:
        if not existing.get("full_name"):
            await db.users.update_one(
                {"_id": existing["_id"]},
                {"$set": {"full_name": "Nguyễn Tuấn Anh"}},
            )


async def _ensure_default_cells():
    if await db.cells.count_documents({}) == 0:
        now = datetime.utcnow()
        seeds = [
            {"code": "TTG", "name": "Trại tạm giam", "capacity": 0, "note": "",
             "level": "facility", "parent": None, "custody_type": "tam_giam"},
            {"code": "NTG", "name": "Nhà tạm giữ", "capacity": 0, "note": "",
             "level": "facility", "parent": None, "custody_type": "tam_giu"},
            {"code": "PT1", "name": "Phân trại 1", "capacity": 0, "note": "",
             "level": "sub_camp", "parent": "TTG", "custody_type": None},
            {"code": "PT2", "name": "Phân trại 2", "capacity": 0, "note": "",
             "level": "sub_camp", "parent": "TTG", "custody_type": None},
            {"code": "B101", "name": "Buồng 101", "capacity": 20, "note": "Phân trại 1",
             "level": "cell", "parent": "PT1", "custody_type": None},
            {"code": "B102", "name": "Buồng 102", "capacity": 20, "note": "Phân trại 1",
             "level": "cell", "parent": "PT1", "custody_type": None},
            {"code": "B201", "name": "Buồng 201", "capacity": 25, "note": "Phân trại 2",
             "level": "cell", "parent": "PT2", "custody_type": None},
            {"code": "B01", "name": "Buồng 01", "capacity": 15, "note": "Nhà tạm giữ",
             "level": "cell", "parent": "NTG", "custody_type": None},
            {"code": "B02", "name": "Buồng 02", "capacity": 15, "note": "Nhà tạm giữ - nữ",
             "level": "cell", "parent": "NTG", "custody_type": None},
        ]
        for s in seeds:
            s.update({"created_at": now, "updated_at": now})
        await db.cells.insert_many(seeds)


async def _ensure_indexes():
    await db.detainees.create_index("personal_id", unique=True, sparse=True)
    await db.detainees.create_index([("full_name", 1), ("dob", 1)])
    await db.detainees.create_index("cccd_number", sparse=True)
    await db.cells.create_index("code", unique=True)
    await db.scene_traces.create_index([("case_id", 1), ("seq", 1)])


async def _next_case_code() -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    counter_id = f"case_code_{today}"
    doc = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = doc["seq"] if doc else 1
    return f"VA{today}-{seq:04d}"


async def _next_cell_code_by_level(level: str, parent: Optional[str]) -> str:
    prefix_map = {"facility": "CS", "sub_camp": "PT", "cell": "BG"}
    counter_id = f"cell_code_{prefix_map.get(level, 'X')}"
    doc = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = doc["seq"] if doc else 1
    return f"{prefix_map.get(level, 'X')}{seq:03d}"


async def _next_scene_seq(case_oid) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": f"scene_seq_{case_oid}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return int(doc.get("seq", 1))


async def _case_detainee_counts(case_ids: list) -> dict:
    if not case_ids:
        return {}
    all_ids = []
    for cid in case_ids:
        if cid:
            if cid not in all_ids:
                all_ids.append(cid)
            scid = str(cid)
            if scid not in all_ids:
                all_ids.append(scid)
            try:
                oid = ObjectId(str(cid))
                if oid not in all_ids:
                    all_ids.append(oid)
            except Exception:
                pass
    out: dict = {}
    cursor = db.detainees.aggregate([
        {"$match": {"case_id": {"$in": all_ids}}},
        {"$group": {"_id": "$case_id", "n": {"$sum": 1}}},
    ])
    async for row in cursor:
        out[str(row["_id"])] = row["n"]
    return out


async def _log(request: Request, user: dict, action: str, resource: str, ref: str = "", data: dict = None, ref_id: str = "", case_id=None):
    try:
        entry = {
            "at": datetime.utcnow(),
            "actor": user.get("username", "") if isinstance(user, dict) else str(user),
            "action": action,
            "resource": resource,
            "ref": ref,
            "ref_id": ref_id,
            "ip": (request.client.host if request and request.client else ""),
            "data": data or {},
            "case_id": case_id,
        }
        await db.audit_logs.insert_one(entry)
    except Exception:
        pass


def _ensure_case_editable(case_doc: dict) -> None:
    if case_doc.get("status") == "closed":
        raise HTTPException(403, "Vụ án đã kết thúc, không thể chỉnh sửa.")


async def _latest_open_case_or_none() -> Optional[dict]:
    return await db.cases.find_one(
        {"status": "investigating"},
        sort=[("created_at", -1)],
    )
