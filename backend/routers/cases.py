import io
import os
import re
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from core.config import FP_KEY_BY_CODE, REPORTS_DIR, SYNC_REMOTE
from core.security import get_current_user, deny_admin_write
from schemas.cases import CaseIn, CasePatch
from schemas.sync import SyncLogBody
from services.case_report import _build_case_report_xlsx
import db.mongo as db_module

router = APIRouter(tags=["Cases"])

_CASE_DETAINEE_PROJECTION = {
    "code": 1, "personal_id": 1, "full_name": 1, "cccd_number": 1, "gender": 1,
    "dob": 1, "cell_code": 1, "created_at": 1,
    "photo_url": 1, "photos.portrait_front": 1, "photos.cccd_front": 1,
    **{f"photos.{k}": 1 for k in FP_KEY_BY_CODE.values()},
}


@router.post("/api/cases")
async def create_case(body: CaseIn, request: Request, user: dict = Depends(get_current_user)):
    deny_admin_write(user, "tạo")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Tên vụ án không được để trống.")
    now = datetime.utcnow()
    officer_name = (body.officer_name or "").strip() or user.get("full_name") or user.get("username", "")
    officer_rank = (body.officer_rank or "").strip()
    doc = {
        "code": await db_module._next_case_code(),
        "status": "investigating",
        "name": name,
        "location": body.location.strip(),
        "officer_name": officer_name,
        "officer_rank": officer_rank,
        "occurred_at": db_module._parse_dt(body.occurred_at),
        "note": body.note.strip(),
        "created_at": now,
        "created_by": user["username"],
        "closed_at": None,
        "report_url": None,
        "report_filename": None,
    }
    res = await db_module.db.cases.insert_one(doc)
    doc["_id"] = res.inserted_id
    await db_module._log(request, user, "create", "case", doc["code"], ref_id=str(res.inserted_id), case_id=res.inserted_id)
    out = db_module._s_case(doc)
    out["detainee_count"] = 0
    return out


@router.patch("/api/cases/{case_id}")
async def update_case(
    case_id: str,
    body: CasePatch,
    request: Request,
    user: dict = Depends(get_current_user),
):
    deny_admin_write(user, "sửa")
    doc = await db_module.db.cases.find_one({"_id": db_module._oid(case_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy vụ án.")

    patch: dict = {}
    if body.status is not None and body.status != doc.get("status"):
        patch["status"] = body.status
        patch["closed_at"] = datetime.utcnow() if body.status == "closed" else None
    content_keys = (body.name, body.location, body.officer_name, body.officer_rank, body.note, body.occurred_at)
    if any(v is not None for v in content_keys) and "status" not in patch:
        db_module._ensure_case_editable(doc)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "Tên vụ án không được để trống.")
        patch["name"] = name
    if body.location is not None:
        patch["location"] = body.location.strip()
    if body.officer_name is not None:
        patch["officer_name"] = body.officer_name.strip()
    if body.officer_rank is not None:
        patch["officer_rank"] = body.officer_rank.strip()
    if body.note is not None:
        patch["note"] = body.note.strip()
    if body.occurred_at is not None:
        patch["occurred_at"] = db_module._parse_dt(body.occurred_at)
    if not patch:
        return db_module._s_case(doc)

    patch["updated_at"] = datetime.utcnow()
    await db_module.db.cases.update_one({"_id": doc["_id"]}, {"$set": patch})
    await db_module._log(
        request, user, "update", "case", doc.get("code", ""),
        {k: (v.isoformat() if isinstance(v, datetime) else v)
         for k, v in patch.items() if k != "updated_at"},
        ref_id=case_id, case_id=doc["_id"],
    )
    return db_module._s_case({**doc, **patch})


@router.get("/api/cases/full")
async def list_cases_full(
    status: Optional[str] = Query(None, pattern=r"^(investigating|closed)$"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    include_detainees: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    filt: dict = {}
    if status:
        filt["status"] = status
    dt_from = db_module._parse_dt(date_from)
    dt_to = db_module._parse_dt(date_to)
    if dt_from or dt_to:
        rng: dict = {}
        if dt_from:
            rng["$gte"] = dt_from
        if dt_to:
            rng["$lte"] = dt_to
        filt["created_at"] = rng

    total = await db_module.db.cases.count_documents(filt)
    open_count = await db_module.db.cases.count_documents({**filt, "status": "investigating"})
    closed_count = await db_module.db.cases.count_documents({**filt, "status": "closed"})

    items: list[dict] = []
    async for s in db_module.db.cases.find(filt).sort("created_at", -1).skip(skip).limit(limit):
        row = db_module._s_case(s)
        if include_detainees:
            detainees = []
            async for d in db_module.db.detainees.find({"case_id": s["_id"]}).sort("created_at", 1):
                detainees.append({
                    "id": str(d["_id"]),
                    "personal_id": d.get("personal_id", "") or d.get("cccd_number", "") or "",
                    "full_name": d.get("full_name", ""),
                    "cccd_number": d.get("cccd_number", "") or "",
                    "gender": d.get("gender", "male"),
                    "dob": d.get("dob") or None,
                    "nationality": d.get("nationality", "") or "",
                    "ethnicity": d.get("ethnicity", "") or "",
                    "religion": d.get("religion", "") or "",
                    "hometown": d.get("hometown", "") or "",
                    "address": d.get("address", "") or "",
                    "temp_address": d.get("temp_address", "") or "",
                    "current_address": d.get("current_address", "") or "",
                    "occupation": d.get("occupation", "") or "",
                    "father_name": d.get("father_name", "") or "",
                    "mother_name": d.get("mother_name", "") or "",
                    "case_about": d.get("case_about", "") or "",
                    "issued_date": d["issued_date"].isoformat() if isinstance(d.get("issued_date"), datetime) else None,
                    "expiry_date": d.get("expiry_date") or None,
                    "height_cm": d.get("height_cm"),
                    "weight_kg": d.get("weight_kg"),
                    "cell_code": d.get("cell_code", "") or "",
                    "charge": d.get("charge", "") or "",
                    "date_in": d.get("date_in") or None,
                    "note": d.get("note", "") or "",
                    "photos": d.get("photos") or {},
                    "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else None,
                    "updated_at": d["updated_at"].isoformat() if isinstance(d.get("updated_at"), datetime) else None,
                    "created_by": d.get("created_by", ""),
                })
            row["detainees"] = detainees
            row["detainee_count"] = row.get("detainee_count", len(detainees))
        items.append(row)

    return {
        "total": total,
        "open_count": open_count,
        "closed_count": closed_count,
        "skip": skip,
        "limit": limit,
        "items": items,
    }


@router.get("/api/cases")
async def list_cases(
    status: Optional[str] = Query(None, pattern=r"^(investigating|closed)$"),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=200),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    filt: dict = {}
    if status:
        filt["status"] = status
    dt_from = db_module._parse_dt(date_from)
    dt_to = db_module._parse_dt(date_to)
    if dt_from or dt_to:
        rng: dict = {}
        if dt_from:
            rng["$gte"] = dt_from
        if dt_to:
            rng["$lte"] = dt_to
        filt["occurred_at"] = rng
    if q and q.strip():
        needle = re.escape(q.strip())
        filt["$or"] = [
            {"code": {"$regex": needle, "$options": "i"}},
            {"name": {"$regex": needle, "$options": "i"}},
            {"location": {"$regex": needle, "$options": "i"}},
            {"officer_name": {"$regex": needle, "$options": "i"}},
            {"officer_rank": {"$regex": needle, "$options": "i"}},
        ]
    total = await db_module.db.cases.count_documents(filt)
    docs = [
        d async for d in db_module.db.cases.find(filt).sort("created_at", -1).skip(skip).limit(limit)
    ]
    counts = await db_module._case_detainee_counts([d["_id"] for d in docs])
    items = []
    for d in docs:
        row = db_module._s_case(d)
        row["detainee_count"] = counts.get(row["id"], 0)
        items.append(row)
    return {"total": total, "items": items, "skip": skip, "limit": limit}


@router.get("/api/cases/{case_id}")
async def get_case_detail(case_id: str, user: dict = Depends(get_current_user)):
    doc = await db_module.db.cases.find_one({"_id": db_module._oid(case_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy vụ án.")
    detainees = []
    async for d in (
        db_module.db.detainees
        .find({"case_id": doc["_id"]}, _CASE_DETAINEE_PROJECTION)
        .sort("created_at", 1)
    ):
        photos = d.get("photos") or {}
        fingerprints = {
            code: (photos.get(key) or "")
            for code, key in FP_KEY_BY_CODE.items()
        }
        detainees.append({
            "id": str(d["_id"]),
            "code": d.get("code", ""),
            "personal_id": d.get("personal_id", "") or "",
            "full_name": d.get("full_name", ""),
            "cccd_number": d.get("cccd_number", "") or "",
            "gender": d.get("gender", "male"),
            "dob": (d["dob"].isoformat() if isinstance(d.get("dob"), datetime) else d.get("dob")) or None,
            "cell_code": d.get("cell_code", "") or "",
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else None,
            "portrait": photos.get("portrait_front") or photos.get("cccd_front") or d.get("photo_url") or "",
            "fingerprints": fingerprints,
            "fp_count": sum(1 for v in fingerprints.values() if v),
        })
    out = db_module._s_case(doc)
    out["detainees"] = detainees
    out["detainee_count"] = len(detainees)
    out["trace_count"] = await db_module.db.scene_traces.count_documents({"case_id": doc["_id"]})
    return out


@router.post("/api/cases/{case_id}/sync-log")
async def log_case_sync(
    case_id: str,
    body: SyncLogBody,
    request: Request,
    user: dict = Depends(get_current_user),
):
    doc = await db_module.db.cases.find_one({"_id": db_module._oid(case_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy vụ án.")

    def _pack(items):
        return [
            {
                "code": it.code,
                "full_name": it.full_name,
                "cccd_number": it.cccd_number,
            }
            for it in items
        ]

    data = {
        "added": int(body.added or 0),
        "updated": int(body.updated or 0),
        "duplicated": int(body.duplicated or 0),
        "failed": int(body.failed or 0),
        "added_items": _pack(body.added_items),
        "updated_items": _pack(body.updated_items),
        "duplicate_items": _pack(body.duplicate_items),
        "failed_items": _pack(body.failed_items),
        "remote": body.remote or SYNC_REMOTE,
    }
    if body.error:
        data["error"] = body.error
    await db_module._log(
        request,
        user,
        "sync",
        "case",
        doc.get("code", ""),
        data,
        ref_id=case_id,
        case_id=doc["_id"],
    )
    return {"ok": True}


@router.get("/api/cases/{case_id}/report")
async def download_case_report(case_id: str, user: dict = Depends(get_current_user)):
    doc = await db_module.db.cases.find_one({"_id": db_module._oid(case_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy vụ án.")
    _, filename = await _build_case_report_xlsx(doc)
    filepath = os.path.join(REPORTS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(500, "Tạo báo cáo thất bại.")
    with open(filepath, "rb") as f:
        data = f.read()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/api/cases/{case_id}")
async def delete_case(case_id: str, request: Request, user: dict = Depends(get_current_user)):
    deny_admin_write(user, "xoá")
    doc = await db_module.db.cases.find_one({"_id": db_module._oid(case_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy vụ án.")
    if doc.get("status") != "investigating":
        raise HTTPException(400, "Chỉ có thể xoá vụ án đang điều tra. Vụ đã kết thúc là hồ sơ lưu.")
    cursor = db_module.db.detainees.find({"case_id": doc["_id"]}, {"personal_id": 1})
    deleted_count = 0
    async for d in cursor:
        await db_module.db.detainees.delete_one({"_id": d["_id"]})
        deleted_count += 1
        await db_module._log(request, user, "delete", "detainee", d.get("personal_id", str(d["_id"])), ref_id=str(d["_id"]), case_id=doc["_id"])
    deleted_traces = 0
    async for t in db_module.db.scene_traces.find({"case_id": doc["_id"]}, {"url": 1}):
        db_module._delete_scene_file(t.get("url"))
        deleted_traces += 1
    await db_module.db.scene_traces.delete_many({"case_id": doc["_id"]})
    await db_module.db.cases.delete_one({"_id": doc["_id"]})
    await db_module._log(
        request, user, "delete", "case", doc.get("code", ""),
        ref_id=case_id, case_id=doc["_id"],
        data={"deleted_detainees": deleted_count, "deleted_traces": deleted_traces},
    )
    return {"ok": True, "deleted_detainees": deleted_count, "deleted_traces": deleted_traces}
