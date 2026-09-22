import httpx
from core.config import (
    FP_FINGER_CODES,
    FP_MIN_QUALITY_DEFAULT,
    FP_MIN_QUALITY_MAX,
    FP_SERVICE_URL,
)
import db.mongo as db_module

_fp_min_quality_cache: dict = {c: FP_MIN_QUALITY_DEFAULT for c in FP_FINGER_CODES}


def get_fp_min_quality() -> dict:
    return dict(_fp_min_quality_cache)


def _sanitize_fp_map(raw) -> dict:
    out: dict = {}
    if isinstance(raw, dict):
        for code, val in raw.items():
            if code in _fp_min_quality_cache:
                try:
                    n = int(val)
                except (TypeError, ValueError):
                    continue
                if 0 <= n <= FP_MIN_QUALITY_MAX:
                    out[code] = n
    return out


async def _load_fp_config():
    doc = await db_module.db.settings.find_one({"_id": "fingerprint"})
    if doc is None:
        await db_module.db.settings.insert_one({
            "_id": "fingerprint",
            "by_finger": dict(_fp_min_quality_cache),
        })
        return
    got = _sanitize_fp_map(doc.get("by_finger"))
    if not got and doc.get("min_quality") is not None:
        one = _sanitize_fp_map({c: doc.get("min_quality") for c in _fp_min_quality_cache})
        got = one
    if got:
        _fp_min_quality_cache.update(got)


async def _push_fp_quality(by_finger: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{FP_SERVICE_URL}/api/config/quality",
                json={"by_finger": dict(by_finger)},
            )
        return resp.status_code == 200
    except Exception:
        return False


async def _push_fp_quality_safe():
    try:
        await _push_fp_quality(get_fp_min_quality())
    except Exception:
        pass
