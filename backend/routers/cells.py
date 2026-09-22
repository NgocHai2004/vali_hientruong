from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from core.security import get_current_user
from schemas.detainees import CellIn
import db.mongo as db_module

router = APIRouter(tags=["Cells"])


@router.get("/api/cells")
async def list_cells(user: dict = Depends(get_current_user)):
    cells = [db_module._s(c) async for c in db_module.db.cells.find({}).sort("code", 1)]
    counts = {}
    pipeline = [{"$group": {"_id": "$cell_code", "n": {"$sum": 1}}}]
    async for r in db_module.db.detainees.aggregate(pipeline):
        if r["_id"]:
            counts[r["_id"]] = r["n"]
    for c in cells:
        c["current"] = counts.get(c["code"], 0)
    return cells


@router.post("/api/cells")
async def create_cell(body: CellIn, request: Request, user: dict = Depends(get_current_user)):
    level = body.level
    parent = (body.parent or "").strip() or None
    custody = (body.custody_type or "").strip() or None
    if level == "facility":
        if custody not in ("tam_giam", "tam_giu"):
            raise HTTPException(400, "Cơ sở giam giữ cần diện (tam_giam/tam_giu)")
        parent = None
    else:
        if not parent:
            raise HTTPException(400, f"{level} cần chỉ định node cha (parent)")
        pdoc = await db_module.db.cells.find_one({"code": parent})
        if not pdoc:
            raise HTTPException(400, f"Node cha '{parent}' không tồn tại")
        if level == "sub_camp" and pdoc.get("level") != "facility":
            raise HTTPException(400, "Phân trại phải thuộc một cơ sở giam giữ (facility)")
        if level == "cell" and pdoc.get("level") not in ("sub_camp", "facility"):
            raise HTTPException(400, "Buồng phải thuộc phân trại hoặc cơ sở giam giữ")
        custody = None
    now = datetime.utcnow()
    code = await db_module._next_cell_code_by_level(level, parent)
    doc = body.model_dump()
    doc["code"] = code
    doc["level"] = level
    doc["parent"] = parent
    doc["custody_type"] = custody
    doc.update({"created_at": now, "updated_at": now})
    res = await db_module.db.cells.insert_one(doc)
    doc["_id"] = res.inserted_id
    await db_module._log(request, user, "create", "cell", code)
    return db_module._s(doc)


@router.patch("/api/cells/{cell_id}")
async def update_cell(cell_id: str, body: CellIn, request: Request, user: dict = Depends(get_current_user)):
    upd = body.model_dump()
    upd["updated_at"] = datetime.utcnow()
    doc = await db_module.db.cells.find_one_and_update({"_id": db_module._oid(cell_id)}, {"$set": upd}, return_document=True)
    if not doc:
        raise HTTPException(404, "Không tìm thấy buồng")
    await db_module._log(request, user, "update", "cell", body.code)
    return db_module._s(doc)


@router.delete("/api/cells/{cell_id}")
async def delete_cell(cell_id: str, request: Request, user: dict = Depends(get_current_user)):
    doc = await db_module.db.cells.find_one({"_id": db_module._oid(cell_id)})
    if not doc:
        raise HTTPException(404, "Không tìm thấy node")
    code = doc.get("code")
    n_child = await db_module.db.cells.count_documents({"parent": code})
    if n_child > 0:
        raise HTTPException(400, f"Node đang có {n_child} node con, không thể xoá. Xoá con trước.")
    n = await db_module.db.detainees.count_documents({"cell_code": code})
    if n > 0:
        raise HTTPException(400, f"Buồng đang có {n} nghi phạm, không thể xoá")
    await db_module.db.cells.delete_one({"_id": db_module._oid(cell_id)})
    await db_module._log(request, user, "delete", "cell", code)
    return {"ok": True}
