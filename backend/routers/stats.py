from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from core.security import get_current_user
import db.mongo as db_module

router = APIRouter(tags=["Stats & Logs"])


@router.get("/api/stats")
async def stats(user: dict = Depends(get_current_user)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    d14_start = today_start - timedelta(days=13)
    d7_start = today_start - timedelta(days=6)

    total = await db_module.db.detainees.count_documents({})
    today = await db_module.db.detainees.count_documents({"created_at": {"$gte": today_start}})
    yesterday = await db_module.db.detainees.count_documents(
        {"created_at": {"$gte": yesterday_start, "$lt": today_start}}
    )
    male = await db_module.db.detainees.count_documents({"gender": "male"})
    female = await db_module.db.detainees.count_documents({"gender": "female"})

    activity_map: dict = {}
    async for row in db_module.db.detainees.aggregate([
        {"$match": {"created_at": {"$gte": d14_start}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "count": {"$sum": 1},
        }},
    ]):
        activity_map[row["_id"]] = row["count"]
    activity_14d = []
    for i in range(14):
        d = d14_start + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        activity_14d.append({"date": key, "count": activity_map.get(key, 0)})

    top_charges = []
    async for row in db_module.db.detainees.aggregate([
        {"$match": {"charge": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$charge", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]):
        top_charges.append({"charge": row["_id"], "count": row["count"]})

    officer_stats = []
    async for row in db_module.db.audit_logs.aggregate([
        {"$match": {
            "action": "create",
            "resource": "detainee",
            "at": {"$gte": d7_start},
        }},
        {"$group": {"_id": "$actor", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 6},
    ]):
        u = await db_module.db.users.find_one({"username": row["_id"]}) or {}
        officer_stats.append({
            "username": row["_id"],
            "full_name": u.get("full_name") or row["_id"],
            "avatar_url": u.get("avatar_url"),
            "count": row["count"],
        })

    investigating_cases = await db_module.db.cases.count_documents({"status": "investigating"})
    recent_case_docs = [d async for d in db_module.db.cases.find({}).sort("created_at", -1).limit(5)]
    case_counts = await db_module._case_detainee_counts([d["_id"] for d in recent_case_docs])
    recent_cases = []
    for d in recent_case_docs:
        row = db_module._s_case(d)
        row["detainee_count"] = case_counts.get(row["id"], 0)
        recent_cases.append(row)

    missing_data_count = await db_module.db.detainees.count_documents({"$or": [
        {"photos.portrait_front": {"$in": [None, ""]}},
        {"photos.portrait_front": {"$exists": False}},
        {"cccd_number": {"$in": [None, ""]}},
    ]})

    recent_activity = []
    async for l in db_module.db.audit_logs.find({}).sort("at", -1).limit(8):
        u = await db_module.db.users.find_one({"username": l.get("actor", "")}) or {}
        recent_activity.append({
            "id": str(l.get("_id")),
            "at": l.get("at").isoformat() if isinstance(l.get("at"), datetime) else None,
            "actor": l.get("actor"),
            "actor_full_name": u.get("full_name") or l.get("actor"),
            "action": l.get("action"),
            "resource": l.get("resource"),
            "ref": l.get("ref"),
        })

    recent = [db_module._s(d) async for d in db_module.db.detainees.find({}).sort("created_at", -1).limit(5)]

    return {
        "total": total,
        "today": today,
        "yesterday": yesterday,
        "male": male,
        "female": female,
        "activity_14d": activity_14d,
        "top_charges": top_charges,
        "today_by_officer": officer_stats,
        "investigating_cases": investigating_cases,
        "recent_cases": recent_cases,
        "missing_data_count": missing_data_count,
        "recent_activity": recent_activity,
        "recent": recent,
    }


@router.get("/api/logs")
async def list_logs(
    limit: int = Query(500, ge=1, le=5000),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    resource: Optional[str] = Query(None),
    case_code: Optional[str] = Query(None),
    actor: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    filt: dict = {}
    dt_from = db_module._parse_dt(date_from)
    dt_to = db_module._parse_dt(date_to)
    if dt_from or dt_to:
        rng: dict = {}
        if dt_from:
            rng["$gte"] = dt_from
        if dt_to:
            rng["$lte"] = dt_to
        filt["at"] = rng
    if action:
        filt["action"] = action
    if resource:
        filt["resource"] = resource
    if user.get("role") != "admin":
        filt["actor"] = user["username"]
    elif actor:
        filt["actor"] = actor
    if case_code:
        case = await db_module.db.cases.find_one({"code": case_code})
        if case:
            filt["case_id"] = case["_id"]
        else:
            filt["case_id"] = None
            filt["_impossible"] = True

    case_cache: dict = {}
    user_cache: dict = {}
    detainee_cache: dict = {}

    async def _resolve_detainee(ref_id, ref):
        if not ref_id and not ref:
            return None
        key = ref_id or ("ref:" + ref)
        if key not in detainee_cache:
            d = None
            if ref_id:
                try:
                    d = await db_module.db.detainees.find_one({"_id": db_module._oid(ref_id)})
                except Exception:
                    d = None
            if d is None and ref:
                d = await db_module.db.detainees.find_one({"personal_id": ref})
            detainee_cache[key] = {
                "full_name": (d or {}).get("full_name", "") or "",
                "cccd_number": (d or {}).get("cccd_number", "") or "",
            } if d else None
        return detainee_cache[key]

    async def _resolve_case(cid):
        if cid is None:
            return None
        key = str(cid)
        if key not in case_cache:
            c = await db_module.db.cases.find_one({"_id": cid})
            case_cache[key] = {
                "code": c.get("code", ""),
                "name": c.get("name", ""),
                "status": c.get("status", ""),
            } if c else None
        return case_cache[key]

    async def _resolve_user(uname):
        if not uname:
            return None
        if uname not in user_cache:
            u = await db_module.db.users.find_one({"username": uname})
            user_cache[uname] = {
                "username": uname,
                "full_name": (u or {}).get("full_name", "") or "",
                "avatar_url": (u or {}).get("avatar_url", "") or "",
            }
        return user_cache[uname]

    items = []
    async for l in db_module.db.audit_logs.find(filt).sort("at", -1).limit(limit):
        l["id"] = str(l.pop("_id"))
        if isinstance(l.get("at"), datetime):
            l["at"] = l["at"].isoformat()
        cid = l.get("case_id")
        l["case"] = await _resolve_case(cid) if cid is not None else None
        if cid is not None:
            l["case_id"] = str(cid)
        l["officer"] = await _resolve_user(l.get("actor"))
        l["detainee"] = await _resolve_detainee(l.get("ref_id"), l.get("ref"))
        items.append(l)

    counts = {"create": 0, "update": 0, "delete": 0, "login": 0, "import": 0, "sync": 0}
    count_filt = dict(filt)
    count_filt.pop("_impossible", None)
    pipeline = [{"$match": count_filt}, {"$group": {"_id": "$action", "n": {"$sum": 1}}}]
    async for r in db_module.db.audit_logs.aggregate(pipeline):
        counts[r["_id"]] = r["n"]

    return {"items": items, "counts": counts, "total": len(items)}
