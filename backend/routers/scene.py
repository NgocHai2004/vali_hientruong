import asyncio
import base64
import os
import uuid
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from bson import ObjectId

import hbie_service
from core.config import (
    UPLOAD_DIR,
    SCENE_UPLOAD_DIR,
    SCENE_REPORTS_DIR,
    SCENE_API_KEY,
    SCENE_ALLOWED_EXT,
    SCENE_MAX_BYTES,
    FP_KEY_BY_CODE,
)
from core.security import get_current_user
from schemas.scene_traces import SceneTracePatch, SceneReportGenerateRequest, SceneRematchRequest
from services.hbie_matcher import (
    _spawn_match,
    _match_trace,
    _feature_of_image,
)
from services.scene_report_service import (
    build_scene_report_data,
    generate_scene_report_pdf,
)
import db.mongo as db_module

router = APIRouter(tags=["Scene Traces & Reports"])

_report_jobs: dict[str, dict] = {}
_report_sem = asyncio.Semaphore(2)


from core.storage import get_case_upload_dir

def _require_scene_key(request: Request) -> None:
    if SCENE_API_KEY and request.headers.get("X-Scene-Key", "") != SCENE_API_KEY:
        raise HTTPException(401, "Sai X-Scene-Key")


async def _save_scene_image(data: bytes, ext: str, case_id: Optional[str] = None) -> tuple[str, str]:
    ext = (ext or "").lower()
    if ext not in SCENE_ALLOWED_EXT:
        raise HTTPException(400, "Chỉ hỗ trợ ảnh jpg/png/webp")
    if not data:
        raise HTTPException(400, "Ảnh rỗng")
    if len(data) > SCENE_MAX_BYTES:
        raise HTTPException(400, "Ảnh vượt quá 10MB")
    name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{ObjectId()}{ext}"
    fs_dir, url_prefix = get_case_upload_dir(case_id, sub_folder="traces")
    path = os.path.join(fs_dir, name)
    with open(path, "wb") as f:
        f.write(data)
    return f"{url_prefix}/{name}", name


async def _insert_scene_trace(
    case_doc: dict,
    url: str,
    size: int,
    ext: str,
    *,
    source: str,
    note: str = "",
    trace_type: str = "",
    collection_source: str = "",
    device_id: str = "",
    captured_at: Optional[datetime] = None,
    created_by: str = "",
) -> dict:
    now = datetime.utcnow()
    doc = {
        "case_id": case_doc["_id"],
        "seq": await db_module._next_scene_seq(case_doc["_id"]),
        "url": url,
        "size": size,
        "mime": f"image/{'jpeg' if ext in ('.jpg', '.jpeg') else ext.lstrip('.')}",
        "note": (note or "").strip(),
        "trace_type": (trace_type or "").strip(),
        "collection_source": (collection_source or "").strip(),
        "source": source,
        "device_id": (device_id or "").strip(),
        "captured_at": captured_at or now,
        "created_at": now,
        "created_by": created_by,
        "match_status": "queued" if hbie_service.FEATURE_HBIE_MATCH else "disabled",
        "match_error": "",
        "match_count": 0,
        "face_embedding": None,
        "face_count": None,
    }
    res = await db_module.db.scene_traces.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


async def _scene_case_or_400(case_id: Optional[str]) -> dict:
    if case_id:
        doc = await db_module.db.cases.find_one({"_id": db_module._oid(case_id)})
        if not doc:
            raise HTTPException(400, "Vụ án không tồn tại.")
        return doc
    doc = await db_module._latest_open_case_or_none()
    if not doc:
        raise HTTPException(409, "Chưa có vụ án nào đang điều tra. Cần tạo vụ án trước khi thêm dấu vết hiện trường.")
    return doc


@router.get("/api/scene/health")
async def scene_health(request: Request):
    _require_scene_key(request)
    case = await db_module._latest_open_case_or_none()
    return {
        "ok": True,
        "has_open_case": bool(case),
        "case_id": str(case["_id"]) if case else None,
        "case_code": (case or {}).get("code"),
        "case_name": (case or {}).get("name", ""),
        "max_bytes": SCENE_MAX_BYTES,
        "allowed_ext": sorted(SCENE_ALLOWED_EXT),
    }


@router.post("/api/scene/push")
async def scene_push(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    case_id: Optional[str] = Form(default=None),
    note: str = Form(default=""),
    device_id: str = Form(default=""),
):
    _require_scene_key(request)
    if file is not None:
        data = await file.read()
        ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
        cid, note_in, dev = case_id, note, device_id
    else:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(400, "Thiếu ảnh: gửi multipart field 'file' hoặc JSON 'image_b64'.")
        b64 = (body.get("image_b64") or "").strip()
        if not b64:
            raise HTTPException(400, "Thiếu ảnh: gửi multipart field 'file' hoặc JSON 'image_b64'.")
        if "," in b64[:64] and b64.lstrip().startswith("data:"):
            b64 = b64.split(",", 1)[1]
        try:
            data = base64.b64decode(b64, validate=False)
        except Exception:
            raise HTTPException(400, "image_b64 không phải base64 hợp lệ")
        ext = os.path.splitext(body.get("filename") or "")[1].lower() or ".jpg"
        cid = body.get("case_id") or case_id
        note_in = body.get("note") or ""
        dev = body.get("device_id") or ""

    case_doc = await _scene_case_or_400(cid)
    db_module._ensure_case_editable(case_doc)
    url, _ = await _save_scene_image(data, ext, case_id=str(case_doc["_id"]))
    doc = await _insert_scene_trace(
        case_doc, url, len(data), ext,
        source="push", note=note_in, device_id=dev, created_by="",
    )
    _spawn_match(doc, case_doc)
    return db_module._s_scene(doc)


@router.get("/api/scene/traces")
async def list_scene_traces(
    case_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    case_doc = await _scene_case_or_400(case_id)
    items = [
        db_module._s_scene(d)
        async for d in db_module.db.scene_traces.find({"case_id": db_module._case_id_query(case_doc)}).sort([("seq", 1)])
    ]
    case_info = {
        "id": str(case_doc["_id"]),
        "code": case_doc.get("code", ""),
        "name": case_doc.get("name", ""),
        "case_name": case_doc.get("name", ""),
        "location": case_doc.get("location", ""),
        "status": case_doc.get("status", ""),
        "officer_name": case_doc.get("officer_name", ""),
        "occurred_at": (case_doc.get("occurred_at").isoformat()
                        if isinstance(case_doc.get("occurred_at"), datetime) else None),
    }
    return {
        "case": case_info,
        "session": case_info,
        "items": items,
        "total": len(items),
    }


@router.post("/api/scene/traces")
async def create_scene_trace(
    request: Request,
    file: UploadFile = File(...),
    case_id: Optional[str] = Form(default=None),
    note: str = Form(default=""),
    source: str = Form(default="upload"),
    user: dict = Depends(get_current_user),
):
    case_doc = await _scene_case_or_400(case_id)
    db_module._ensure_case_editable(case_doc)
    data = await file.read()
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    url, _ = await _save_scene_image(data, ext, case_id=str(case_doc["_id"]))
    doc = await _insert_scene_trace(
        case_doc, url, len(data), ext,
        source="camera" if source == "camera" else "upload",
        note=note, created_by=user["username"],
    )
    await db_module._log(request, user, "create", "scene_trace", f"#{doc['seq']}",
               ref_id=str(doc["_id"]), case_id=case_doc["_id"])
    _spawn_match(doc, case_doc)
    return db_module._s_scene(doc)


@router.post("/api/scene/traces/batch", status_code=status.HTTP_202_ACCEPTED)
async def create_scene_traces_batch(
    request: Request,
    files: List[UploadFile] = File(...),
    case_id: Optional[str] = Form(default=None),
    note: str = Form(default=""),
    source: str = Form(default="upload"),
    user: dict = Depends(get_current_user),
):
    if not files:
        raise HTTPException(400, "Cần chọn ít nhất một ảnh dấu vết.")

    case_doc = await _scene_case_or_400(case_id)
    db_module._ensure_case_editable(case_doc)
    batch_id = str(ObjectId())
    accepted = []
    rejected = []

    for file in files:
        filename = file.filename or "image"
        url = ""
        try:
            data = await file.read()
            ext = os.path.splitext(filename)[1].lower() or ".jpg"
            url, _ = await _save_scene_image(data, ext, case_id=str(case_doc["_id"]))
            try:
                doc = await _insert_scene_trace(
                    case_doc, url, len(data), ext,
                    source="camera" if source == "camera" else "upload",
                    note=note, created_by=user["username"],
                )
            except Exception:
                db_module._delete_scene_file(url)
                raise

            await db_module._log(
                request, user, "create", "scene_trace", f"#{doc['seq']}",
                data={"batch_id": batch_id, "filename": filename},
                ref_id=str(doc["_id"]), case_id=case_doc["_id"],
            )
            _spawn_match(doc, case_doc)
            item = db_module._s_scene(doc)
            item["filename"] = filename
            accepted.append(item)
        except HTTPException as ex:
            rejected.append({"filename": filename, "error": str(ex.detail)})
        except Exception:
            rejected.append({"filename": filename, "error": "Không thể lưu ảnh dấu vết."})
        finally:
            await file.close()

    return {
        "batch_id": batch_id,
        "status": "queued" if accepted else "rejected",
        "total": len(files),
        "accepted": len(accepted),
        "rejected": len(rejected),
        "items": accepted,
        "errors": rejected,
    }


@router.patch("/api/scene/traces/{trace_id}")
async def update_scene_trace(
    trace_id: str,
    body: SceneTracePatch,
    request: Request,
    user: dict = Depends(get_current_user),
):
    doc = await db_module.db.scene_traces.find_one({"_id": db_module._oid(trace_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy dấu vết hiện trường.")
    await db_module.db.scene_traces.update_one(
        {"_id": doc["_id"]}, {"$set": {"note": body.note.strip()}}
    )
    doc["note"] = body.note.strip()
    await db_module._log(request, user, "update", "scene_trace", f"#{doc.get('seq')}",
               ref_id=trace_id, case_id=doc.get("case_id"))
    return db_module._s_scene(doc)


@router.delete("/api/scene/traces")
async def delete_scene_traces_by_case(
    request: Request,
    case_id: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
):
    case_doc = await _scene_case_or_400(case_id)
    db_module._ensure_case_editable(case_doc)
    case_query = db_module._case_id_query(case_doc)
    traces = [
        doc async for doc in db_module.db.scene_traces.find(
            {"case_id": case_query}, {"_id": 1, "url": 1}
        )
    ]
    trace_ids = [doc["_id"] for doc in traces]

    trace_result = await db_module.db.scene_traces.delete_many({"case_id": case_query})
    match_result = await db_module.db.scene_matches.delete_many({"case_id": case_query})
    if trace_ids:
        extra = await db_module.db.scene_matches.delete_many({"trace_id": {"$in": trace_ids}})
        deleted_matches = match_result.deleted_count + extra.deleted_count
    else:
        deleted_matches = match_result.deleted_count

    for doc in traces:
        db_module._delete_scene_file(doc.get("url"))

    await db_module._log(
        request,
        user,
        "delete",
        "scene_traces",
        case_doc.get("code", case_id),
        case_id=case_doc["_id"],
        data={
            "deleted_traces": trace_result.deleted_count,
            "deleted_matches": deleted_matches,
        },
    )
    return {
        "ok": True,
        "deleted_traces": trace_result.deleted_count,
        "deleted_matches": deleted_matches,
    }


@router.delete("/api/scene/traces/{trace_id}")
async def delete_scene_trace(
    trace_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    doc = await db_module.db.scene_traces.find_one({"_id": db_module._oid(trace_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy dấu vết hiện trường.")
    await db_module.db.scene_traces.delete_one({"_id": doc["_id"]})
    db_module._delete_scene_file(doc.get("url"))
    await db_module.db.scene_matches.delete_many({"trace_id": doc["_id"]})
    await db_module._log(request, user, "delete", "scene_trace", f"#{doc.get('seq')}",
               ref_id=trace_id, case_id=doc.get("case_id"))
    return {"ok": True}


@router.get("/api/scene/matches")
async def list_scene_matches(
    case_id: Optional[str] = Query(default=None),
    trace_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    case_doc = await _scene_case_or_400(case_id)
    q = {"case_id": db_module._case_id_query(case_doc)}
    if trace_id:
        q["trace_id"] = db_module._oid(trace_id)
    items = [
        db_module._s_match(d)
        async for d in db_module.db.scene_matches.find(q).sort([("score", -1), ("trace_seq", 1)])
    ]
    traces = {
        d["_id"]: d
        async for d in db_module.db.scene_traces.find(
            {"case_id": db_module._case_id_query(case_doc)},
            {"url": 1, "seq": 1, "landmark": 1, "img_width": 1, "img_height": 1, "feature_quality": 1},
        )
    }
    det_ids = list({db_module._oid(it["detainee_id"]) for it in items if it.get("detainee_id")})
    detainees = {
        d["_id"]: d
        async for d in db_module.db.detainees.find(
            {"_id": {"$in": det_ids}},
            {"photos": 1, "fp_landmarks": 1, "fp_features": 1},
        )
    }
    for it in items:
        tr = traces.get(db_module._oid(it.get("trace_id")))
        if tr and not (tr.get("landmark") or {}).get("points") and tr.get("url"):
            try:
                out = await _feature_of_image(tr["url"], type_=hbie_service.TYPE_LATENT)
                if out and out.get("landmark"):
                    tr["landmark"] = out["landmark"]
                    tr["img_width"] = out.get("img_width", 0)
                    tr["img_height"] = out.get("img_height", 0)
                    await db_module.db.scene_traces.update_one(
                        {"_id": tr["_id"]},
                        {"$set": {
                            "landmark": tr["landmark"],
                            "img_width": tr["img_width"],
                            "img_height": tr["img_height"],
                        }}
                    )
            except Exception:
                pass
        it["trace_url"] = (tr or {}).get("url", "")
        it["latent_landmarks"] = (tr or {}).get("landmark") or {}
        it["latent_dim"] = {
            "width": (tr or {}).get("img_width", 0),
            "height": (tr or {}).get("img_height", 0),
        }
        det = detainees.get(db_module._oid(it.get("detainee_id")))
        if det:
            finger_code = it.get("finger_code", "")
            code_by_key = {v: k for k, v in FP_KEY_BY_CODE.items()}
            if finger_code in code_by_key:
                std_code = code_by_key[finger_code]
                finger_key = finger_code
            else:
                std_code = finger_code
                finger_key = FP_KEY_BY_CODE.get(finger_code, finger_code)
            photos = det.get("photos") or {}
            cand_url = photos.get(finger_key) or photos.get(std_code) or ""
            it["candidate_url"] = cand_url
            fp_lms = det.get("fp_landmarks") or {}
            lm_data = fp_lms.get(std_code) or fp_lms.get(finger_key) or {}
            if (not isinstance(lm_data, dict) or not (lm_data.get("landmark") or {}).get("points")) and cand_url:
                try:
                    out = await _feature_of_image(cand_url, finger_code=std_code, type_=hbie_service.TYPE_ROLL)
                    if out and out.get("landmark"):
                        lm_data = {
                            "landmark": out["landmark"],
                            "img_width": out.get("img_width", 0),
                            "img_height": out.get("img_height", 0),
                        }
                        await db_module.db.detainees.update_one(
                            {"_id": det["_id"]},
                            {"$set": {
                                f"fp_landmarks.{std_code}": lm_data,
                                f"fp_landmarks.{finger_key}": lm_data,
                            }}
                        )
                except Exception:
                    pass
            if isinstance(lm_data, dict) and "landmark" in lm_data:
                it["candidate_landmarks"] = lm_data.get("landmark") or {}
                it["candidate_dim"] = {
                    "width": lm_data.get("img_width", 0),
                    "height": lm_data.get("img_height", 0),
                }
            elif isinstance(lm_data, dict) and "points" in lm_data:
                it["candidate_landmarks"] = lm_data
                it["candidate_dim"] = {
                    "width": lm_data.get("img_width", 0),
                    "height": lm_data.get("img_height", 0),
                }
            else:
                it["candidate_landmarks"] = lm_data if isinstance(lm_data, dict) else {}
                it["candidate_dim"] = {"width": 0, "height": 0}
        else:
            it["candidate_url"] = ""
            it["candidate_landmarks"] = {}
            it["candidate_dim"] = {"width": 0, "height": 0}
    return {
        "items": items,
        "total": len(items),
        "config": hbie_service.config(),
    }


@router.post("/api/scene/traces/{trace_id}/match")
async def rematch_scene_trace(
    trace_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    if not hbie_service.FEATURE_HBIE_MATCH:
        raise HTTPException(503, "Tính năng đối sánh HBIE đang tắt (FEATURE_HBIE_MATCH=0).")
    doc = await db_module.db.scene_traces.find_one({"_id": db_module._oid(trace_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy dấu vết hiện trường.")
    case_doc = await db_module.db.cases.find_one({"_id": doc["case_id"]})
    if not case_doc:
        raise HTTPException(404, "Không tìm thấy vụ án của dấu vết này.")
    try:
        res = await _match_trace(doc, case_doc)
    except hbie_service.HbieError as e:
        await db_module.db.scene_traces.update_one(
            {"_id": doc["_id"]},
            {"$set": {"match_status": "error", "match_error": str(e)[:300]}},
        )
        raise HTTPException(502, str(e))
    await db_module._log(request, user, "match", "scene_trace", f"#{doc.get('seq')}",
               ref_id=trace_id, case_id=doc.get("case_id"), data=res)
    return res


@router.post("/api/scene/rematch")
async def rematch_scene_case(
    case_id: Optional[str] = Query(default=None),
    body: Optional[SceneRematchRequest] = None,
    request: Request = None,
    user: dict = Depends(get_current_user),
):
    if not hbie_service.FEATURE_HBIE_MATCH:
        raise HTTPException(503, "Tính năng đối sánh HBIE đang tắt (FEATURE_HBIE_MATCH=0).")
    effective_case_id = (body.case_id if body and body.case_id else case_id)
    extra_case_ids = (body.extra_case_ids if body and body.extra_case_ids else [])
    case_doc = await _scene_case_or_400(effective_case_id)
    traces = await db_module.db.scene_traces.find({"case_id": db_module._case_id_query(case_doc)}).sort("seq", 1).to_list(1000)
    traces_count = len(traces)
    matched_count = 0
    errors = []
    sem = asyncio.Semaphore(5)

    async def _process_trace(tr):
        async with sem:
            try:
                res = await _match_trace(tr, case_doc, extra_case_ids=extra_case_ids)
                return res.get("count", 0), None
            except Exception as e:
                err_msg = f"Dấu vết #{tr.get('seq')}: {e}"
                await db_module.db.scene_traces.update_one(
                    {"_id": tr["_id"]},
                    {"$set": {"match_status": "error", "match_error": str(e)[:300], "matched_at": datetime.utcnow()}},
                )
                return 0, err_msg

    results = await asyncio.gather(*[_process_trace(tr) for tr in traces], return_exceptions=True)
    for r in results:
        if isinstance(r, tuple):
            matched_count += r[0]
            if r[1]:
                errors.append(r[1])

    await db_module._log(request, user, "match", "scene_case", case_doc.get("code", ""),
               ref_id=str(case_doc["_id"]), case_id=case_doc["_id"],
               data={"traces_count": traces_count, "matched_count": matched_count, "extra_case_ids": extra_case_ids, "errors": errors})
    return {
        "ok": True,
        "traces_count": traces_count,
        "matched_count": matched_count,
        "extra_case_ids": extra_case_ids,
        "errors": errors,
    }


@router.post("/api/scene/cases/{case_id}/match")
async def rematch_scene_case_by_id(
    case_id: str,
    body: Optional[SceneRematchRequest] = None,
    request: Request = None,
    user: dict = Depends(get_current_user),
):
    return await rematch_scene_case(case_id=case_id, body=body, request=request, user=user)


@router.get("/api/scene/hbie/health")
async def scene_hbie_health(user: dict = Depends(get_current_user)):
    return {**await hbie_service.health(), "config": hbie_service.config()}


async def _run_generate_report_task(
    report_id: str,
    case_id: Optional[str],
    scope: str,
    match_id: Optional[str],
    user: Optional[dict],
    report_data: dict,
):
    async with _report_sem:
        try:
            _report_jobs[report_id]["status"] = "generating"
            _report_jobs[report_id]["progress"] = 30
            try:
                await db_module.db.report_jobs.update_one(
                    {"_id": report_id},
                    {"$set": {"status": "generating", "progress": 30}}
                )
            except Exception:
                pass
            pdf_path = await generate_scene_report_pdf(
                db=db_module.db,
                case_id=case_id,
                scope=scope,
                match_id=match_id,
                current_user=user,
                upload_dir=UPLOAD_DIR,
                reports_dir=SCENE_REPORTS_DIR,
                report_data=report_data,
            )
            fname = os.path.basename(pdf_path)
            res_url = f"/api/scene/reports/{report_id}/pdf"
            _report_jobs[report_id].update({
                "status": "completed",
                "progress": 100,
                "pdf_path": pdf_path,
                "filename": fname,
                "url": res_url,
            })
            try:
                await db_module.db.report_jobs.update_one(
                    {"_id": report_id},
                    {"$set": {
                        "status": "completed",
                        "progress": 100,
                        "pdf_path": pdf_path,
                        "filename": fname,
                        "url": res_url,
                    }}
                )
            except Exception:
                pass
        except Exception as e:
            import traceback
            traceback.print_exc()
            err_text = f"{type(e).__name__}: {str(e)}" if str(e) else repr(e)
            _report_jobs[report_id]["status"] = "error"
            _report_jobs[report_id]["error"] = err_text
            try:
                await db_module.db.report_jobs.update_one(
                    {"_id": report_id},
                    {"$set": {"status": "error", "error": err_text}}
                )
            except Exception:
                pass


@router.post("/api/scene/reports/generate")
async def generate_scene_report_endpoint(
    body: SceneReportGenerateRequest,
    user: dict = Depends(get_current_user),
):
    report_data = await build_scene_report_data(
        db_module.db, case_id=body.case_id, scope=body.scope or "all", match_id=body.match_id,
        current_user=user, upload_dir=UPLOAD_DIR,
    )
    report_id = uuid.uuid4().hex[:12]
    job_data = {
        "_id": report_id,
        "id": report_id,
        "owner": user["username"],
        "case_id": body.case_id,
        "scope": body.scope or "all",
        "match_id": body.match_id,
        "status": "pending",
        "progress": 10,
        "created_at": datetime.utcnow().isoformat(),
        "pdf_path": None,
        "filename": None,
        "url": None,
        "error": None,
    }
    _report_jobs[report_id] = job_data
    try:
        await db_module.db.report_jobs.insert_one(dict(job_data))
    except Exception:
        pass
    asyncio.create_task(
        _run_generate_report_task(
            report_id=report_id,
            case_id=body.case_id,
            scope=body.scope or "all",
            match_id=body.match_id,
            user=user,
            report_data=report_data,
        )
    )
    return {"report_id": report_id, "status": "pending", "cached": False}


@router.get("/api/scene/reports/{report_id}/status")
async def get_scene_report_status_endpoint(
    report_id: str,
    user: dict = Depends(get_current_user),
):
    job = _report_jobs.get(report_id)
    if not job:
        try:
            job = await db_module.db.report_jobs.find_one({"_id": report_id})
            if job:
                _report_jobs[report_id] = job
        except Exception:
            pass
    if not job or job.get("owner") != user["username"]:
        raise HTTPException(404, "Không tìm thấy phiên xuất báo cáo")
    return {
        "report_id": report_id,
        "status": job["status"],
        "progress": job.get("progress", 0),
        "url": job.get("url"),
        "filename": job.get("filename"),
        "error": job.get("error"),
    }


@router.get("/api/scene/reports/{report_id}/pdf")
async def get_scene_report_pdf_endpoint(
    report_id: str,
    download: Optional[int] = 0,
    user: dict = Depends(get_current_user),
):
    job = _report_jobs.get(report_id)
    if not job:
        try:
            job = await db_module.db.report_jobs.find_one({"_id": report_id})
            if job:
                _report_jobs[report_id] = job
        except Exception:
            pass
    if not job or job.get("owner") != user["username"] or job.get("status") != "completed" or not job.get("pdf_path"):
        raise HTTPException(404, "Báo cáo chưa hoàn thành hoặc không tồn tại")
    pdf_path = job["pdf_path"]
    if not os.path.isfile(pdf_path):
        raise HTTPException(404, "File PDF không còn trên máy chủ")

    filename = job.get("filename") or os.path.basename(pdf_path)
    disposition_type = "attachment" if download else "inline"
    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=filename,
        content_disposition_type=disposition_type,
    )


@router.get("/api/scene/reports/preview-data")
async def preview_scene_report_data_endpoint(
    case_id: Optional[str] = None,
    scope: Optional[str] = "all",
    match_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    return await build_scene_report_data(
        db=db_module.db,
        case_id=case_id,
        scope=scope,
        match_id=match_id,
        current_user=user,
        upload_dir=UPLOAD_DIR,
    )
