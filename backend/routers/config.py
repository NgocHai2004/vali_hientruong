from fastapi import APIRouter, Depends, HTTPException, Request
import hbie_service
from core.config import (
    FP_MIN_QUALITY_DEFAULT,
    FP_MIN_QUALITY_MAX,
    FP_FINGER_CODES,
)
from core.security import get_current_user, require_admin
from schemas.scene_traces import FingerprintConfigIn, HbieConfigIn
from services.fp_quality import (
    get_fp_min_quality,
    _sanitize_fp_map,
    _fp_min_quality_cache,
    _push_fp_quality,
)
from services.hbie_matcher import (
    _reclassify_hbie_verdicts,
)
import db.mongo as db_module

router = APIRouter(tags=["Config"])


@router.get("/api/config/fingerprint")
async def fingerprint_config(user: dict = Depends(get_current_user)):
    return {
        "by_finger": get_fp_min_quality(),
        "default": FP_MIN_QUALITY_DEFAULT,
        "codes": FP_FINGER_CODES,
    }


@router.put("/api/config/fingerprint")
async def update_fingerprint_config(body: FingerprintConfigIn, request: Request, admin: dict = Depends(require_admin)):
    got = _sanitize_fp_map(body.by_finger)
    if not got:
        raise HTTPException(
            400,
            "Cần ít nhất 1 mã ngón hợp lệ, giá trị nguyên 0-"
            f"{FP_MIN_QUALITY_MAX}.",
        )
    previous = {c: _fp_min_quality_cache[c] for c in got}
    merged = dict(_fp_min_quality_cache)
    merged.update(got)
    await db_module.db.settings.update_one(
        {"_id": "fingerprint"},
        {"$set": {"by_finger": merged}},
        upsert=True,
    )
    _fp_min_quality_cache.update(got)
    applied = await _push_fp_quality(merged)
    changed = {c: v for c, v in got.items() if previous.get(c) != v}
    await db_module._log(request, admin, "update", "setting", "fingerprint",
               {"changed": changed, "previous": {c: previous[c] for c in changed},
                "applied": applied})
    return {
        "by_finger": merged,
        "default": FP_MIN_QUALITY_DEFAULT,
        "codes": FP_FINGER_CODES,
        "applied": applied,
    }


@router.get("/api/config/hbie")
async def hbie_config(user: dict = Depends(get_current_user)):
    return {
        "match_threshold": hbie_service.match_threshold(),
        "keep_score": hbie_service.keep_score(),
        "score_max": hbie_service.HBIE_SCORE_MAX,
        "defaults": {
            "match_threshold": hbie_service.HBIE_MATCH_THRESHOLD_DEFAULT,
            "keep_score": hbie_service.HBIE_KEEP_SCORE_DEFAULT,
        },
        "enabled": hbie_service.FEATURE_HBIE_MATCH,
    }


@router.put("/api/config/hbie")
async def update_hbie_config(body: HbieConfigIn, request: Request, admin: dict = Depends(require_admin)):
    match = int(body.match_threshold)
    keep = int(body.keep_score)
    lo_match = hbie_service.HBIE_MATCH_THRESHOLD_MIN
    lo_keep = hbie_service.HBIE_KEEP_SCORE_MIN
    hi = hbie_service.HBIE_SCORE_MAX
    if not lo_match <= match <= hi:
        raise HTTPException(400, f"Ngưỡng kết luận phải là số nguyên từ {lo_match} đến {hi}.")
    if not lo_keep <= keep <= match:
        raise HTTPException(
            400,
            f"Điểm sàn phải là số nguyên từ {lo_keep} đến bằng ngưỡng kết luận ({match}). "
            "Điểm sàn mà cao hơn ngưỡng kết luận thì không cặp nào còn rơi vào mức cần xem lại.",
        )

    previous = {"match_threshold": hbie_service.match_threshold(),
                "keep_score": hbie_service.keep_score()}
    await db_module.db.settings.update_one(
        {"_id": "hbie"},
        {"$set": {"match_threshold": match, "keep_score": keep}},
        upsert=True,
    )
    hbie_service.set_thresholds(match=match, keep=keep)

    reclassified = {"pairs": 0, "traces": 0}
    if previous["match_threshold"] != match:
        reclassified = await _reclassify_hbie_verdicts(match)

    await db_module._log(request, admin, "update", "setting", "hbie",
               {"match_threshold": match, "keep_score": keep, "previous": previous,
                "reclassified": reclassified})
    return {
        "match_threshold": match,
        "keep_score": keep,
        "score_max": hi,
        "reclassified": reclassified,
        "needs_rematch": previous["keep_score"] != keep,
    }
