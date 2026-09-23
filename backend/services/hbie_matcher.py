from __future__ import annotations
import asyncio
from datetime import datetime
from typing import Optional
from bson import ObjectId
from PIL import Image

import hbie_service
from core.config import FP_KEY_BY_CODE
import db.mongo as db_module

_match_tasks: set = set()


def _sanitize_hbie_int(raw, lo: int, hi: int) -> Optional[int]:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


async def _load_hbie_config():
    doc = await db_module.db.settings.find_one({"_id": "hbie"})
    if doc is None:
        await db_module.db.settings.insert_one({
            "_id": "hbie",
            "match_threshold": hbie_service.HBIE_MATCH_THRESHOLD_DEFAULT,
            "keep_score": hbie_service.HBIE_KEEP_SCORE_DEFAULT,
        })
        return
    match = _sanitize_hbie_int(doc.get("match_threshold"),
                               hbie_service.HBIE_MATCH_THRESHOLD_MIN,
                               hbie_service.HBIE_SCORE_MAX)
    if match is None:
        match = hbie_service.HBIE_MATCH_THRESHOLD_DEFAULT
    keep = _sanitize_hbie_int(doc.get("keep_score"), hbie_service.HBIE_KEEP_SCORE_MIN, match)
    if keep is None:
        keep = min(hbie_service.HBIE_KEEP_SCORE_DEFAULT, match)
    hbie_service.set_thresholds(match=match, keep=keep)


async def _reclassify_hbie_verdicts(threshold: int) -> dict:
    match_cond = {"$cond": [{"$gte": ["$score", threshold]}, "match", "review"]}
    best_cond = {"$cond": [{"$gte": ["$best_score", threshold]}, "match", "review"]}
    pairs_changed = (
        await db_module.db.scene_matches.count_documents({"verdict": "match", "score": {"$lt": threshold}})
        + await db_module.db.scene_matches.count_documents({"verdict": {"$ne": "match"},
                                                  "score": {"$gte": threshold}})
    )
    traces_changed = (
        await db_module.db.scene_traces.count_documents({"best_verdict": "match",
                                               "best_score": {"$lt": threshold}})
        + await db_module.db.scene_traces.count_documents({"best_verdict": {"$nin": ["match", "none"]},
                                                 "best_score": {"$gte": threshold}})
    )
    await db_module.db.scene_matches.update_many({"score": {"$type": "number"}},
                                       [{"$set": {"verdict": match_cond}}])
    await db_module.db.scene_traces.update_many({"best_score": {"$gt": 0}},
                                      [{"$set": {"best_verdict": best_cond}}])
    return {"pairs": int(pairs_changed), "traces": int(traces_changed)}


def _spawn_match(trace_doc: dict, case_doc: dict) -> None:
    if not hbie_service.FEATURE_HBIE_MATCH:
        return
    task = asyncio.create_task(_match_trace_safe(trace_doc, case_doc))
    _match_tasks.add(task)
    task.add_done_callback(_match_tasks.discard)


def _spawn_case_rematch(case_doc: dict, extra_case_ids: list = None) -> None:
    if not hbie_service.FEATURE_HBIE_MATCH:
        return
    task = asyncio.create_task(_rematch_case_safe(case_doc, extra_case_ids=extra_case_ids))
    _match_tasks.add(task)
    task.add_done_callback(_match_tasks.discard)


async def _rematch_case_safe(case_doc: dict, extra_case_ids: list = None) -> None:
    async for tr in db_module.db.scene_traces.find({"case_id": db_module._case_id_query(case_doc)}).sort("seq", 1):
        await _match_trace_safe(tr, case_doc, extra_case_ids=extra_case_ids)


async def _match_trace_safe(trace_doc: dict, case_doc: dict, extra_case_ids: list = None) -> None:
    try:
        await _match_trace(trace_doc, case_doc, extra_case_ids=extra_case_ids)
    except Exception as e:
        await db_module.db.scene_traces.update_one(
            {"_id": trace_doc["_id"]},
            {"$set": {"match_status": "error", "match_error": str(e)[:300],
                      "matched_at": datetime.utcnow()}},
        )


async def _feature_of_image(url: str, *, finger_code: str = "", type_: int) -> Optional[dict]:
    path = db_module._resolve_upload_path(url)
    if not path:
        return None
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None
    img_width, img_height = 0, 0
    try:
        with Image.open(path) as img:
            img_width, img_height = img.size
    except Exception:
        pass
    try:
        out = await hbie_service.extract(data, finger_code=finger_code, type_=type_)
        out["img_width"] = img_width
        out["img_height"] = img_height
        return out
    except hbie_service.HbieError:
        return None


async def _trace_feature(trace_doc: dict) -> str:
    if trace_doc.get("feature") and trace_doc.get("landmark"):
        return trace_doc["feature"]
    out = await _feature_of_image(trace_doc.get("url", ""), type_=hbie_service.TYPE_LATENT)
    if not out:
        if trace_doc.get("feature"):
            return trace_doc["feature"]
        raise hbie_service.HbieError("Không trích được đặc trưng từ ảnh dấu vết này.")
    set_fields = {
        "feature": out["feature"],
        "feature_quality": out.get("quality"),
        "landmark": out.get("landmark") or {},
    }
    if out.get("img_width"):
        set_fields["img_width"] = out["img_width"]
        set_fields["img_height"] = out["img_height"]
    await db_module.db.scene_traces.update_one(
        {"_id": trace_doc["_id"]},
        {"$set": set_fields},
    )
    trace_doc["feature"] = out["feature"]
    trace_doc["landmark"] = out.get("landmark") or {}
    if out.get("img_width"):
        trace_doc["img_width"] = out["img_width"]
        trace_doc["img_height"] = out["img_height"]
    return out["feature"]


async def _detainee_features(det: dict) -> dict:
    photos = det.get("photos") or {}
    cached = dict(det.get("fp_features") or {})
    cached_lm = dict(det.get("fp_landmarks") or {})
    tasks = []
    
    for code, key in FP_KEY_BY_CODE.items():
        if cached.get(code) and cached_lm.get(code):
            continue
        url = photos.get(key) or ""
        if not url:
            continue
        tasks.append((code, url))

    if tasks:
        async def _extract_finger(code, url):
            out = await _feature_of_image(url, finger_code=code, type_=hbie_service.TYPE_ROLL)
            return code, out

        results = await asyncio.gather(*[_extract_finger(c, u) for c, u in tasks], return_exceptions=True)
        fresh = {}
        fresh_lm = {}
        for r in results:
            if isinstance(r, tuple) and r[1]:
                code, out = r
                fresh[code] = out["feature"]
                fresh_lm[code] = {
                    "landmark": out.get("landmark") or {},
                    "img_width": out.get("img_width", 0),
                    "img_height": out.get("img_height", 0),
                }
        if fresh:
            set_dict = {f"fp_features.{c}": v for c, v in fresh.items()}
            for c, lm_data in fresh_lm.items():
                set_dict[f"fp_landmarks.{c}"] = lm_data
            await db_module.db.detainees.update_one(
                {"_id": det["_id"]},
                {"$set": set_dict},
            )
            cached.update(fresh)
    return {c: v for c, v in cached.items() if v}


async def _match_trace(trace_doc: dict, case_doc: dict, extra_case_ids: list = None) -> dict:
    await db_module.db.scene_traces.update_one(
        {"_id": trace_doc["_id"]}, {"$set": {"match_status": "running", "match_error": ""}}
    )
    feature = await _trace_feature(trace_doc)

    main_case_query = {"case_id": db_module._case_id_query(case_doc)}
    or_clauses = [main_case_query]
    extra_case_map = {}
    if extra_case_ids:
        oids = []
        case_search_oids = []
        for cid in extra_case_ids:
            if not cid:
                continue
            oids.append(str(cid))
            try:
                parsed_oid = db_module._oid(str(cid))
                oids.append(parsed_oid)
                case_search_oids.append(parsed_oid)
            except Exception:
                pass
        if oids:
            or_clauses.append({"case_id": {"$in": oids}})
            async for c in db_module.db.cases.find({"_id": {"$in": case_search_oids}}, {"code": 1, "name": 1}):
                extra_case_map[str(c["_id"])] = c
                extra_case_map[c["_id"]] = c

    det_query = {"$or": or_clauses} if len(or_clauses) > 1 else main_case_query

    pairs = []
    async for det in db_module.db.detainees.find(det_query).sort("created_at", 1):
        feats = await _detainee_features(det)
        det_case_id = det.get("case_id")
        is_cross_case = bool(det_case_id and str(det_case_id) != str(case_doc["_id"]))
        origin_case = (extra_case_map.get(str(det_case_id)) or extra_case_map.get(det_case_id)) if is_cross_case else case_doc
        origin_case_code = origin_case.get("code", "") if origin_case else ""
        origin_case_name = origin_case.get("name", "") if origin_case else ""

        async def _match_finger(code, feat):
            try:
                score = await hbie_service.match(feature, feat)
            except hbie_service.HbieError:
                return None
            if score < hbie_service.keep_score():
                return None
            return {
                "case_id": case_doc["_id"],
                "trace_id": trace_doc["_id"],
                "trace_seq": trace_doc.get("seq"),
                "detainee_id": det["_id"],
                "detainee_name": det.get("full_name", ""),
                "detainee_code": det.get("code", "") or det.get("personal_id", ""),
                "finger_code": code,
                "score": score,
                "percent": round(score / 10.0, 1),
                "verdict": hbie_service.verdict_of(score),
                "engine": "hbie",
                "created_at": datetime.utcnow(),
                "is_cross_case": is_cross_case,
                "detainee_case_id": str(det_case_id) if det_case_id else None,
                "origin_case_code": origin_case_code,
                "origin_case_name": origin_case_name,
            }

        match_results = await asyncio.gather(*[_match_finger(code, feat) for code, feat in feats.items()], return_exceptions=True)
        for r in match_results:
            if isinstance(r, dict):
                pairs.append(r)

    pairs.sort(key=lambda p: p["score"], reverse=True)
    if not await db_module.db.scene_traces.find_one({"_id": trace_doc["_id"]}, {"_id": 1}):
        await db_module.db.scene_matches.delete_many({"trace_id": trace_doc["_id"]})
        return {"count": 0, "best": 0, "cancelled": True}
    await db_module.db.scene_matches.delete_many({"trace_id": trace_doc["_id"]})
    if pairs:
        await db_module.db.scene_matches.insert_many(pairs)
    if not await db_module.db.scene_traces.find_one({"_id": trace_doc["_id"]}, {"_id": 1}):
        await db_module.db.scene_matches.delete_many({"trace_id": trace_doc["_id"]})
        return {"count": 0, "best": 0, "cancelled": True}
    best = pairs[0] if pairs else None
    await db_module.db.scene_traces.update_one(
        {"_id": trace_doc["_id"]},
        {"$set": {
            "match_status": "done",
            "match_error": "",
            "matched_at": datetime.utcnow(),
            "match_count": len(pairs),
            "best_score": best["score"] if best else 0,
            "best_verdict": best["verdict"] if best else "none",
        }},
    )
    return {"count": len(pairs), "best": best["score"] if best else 0}
