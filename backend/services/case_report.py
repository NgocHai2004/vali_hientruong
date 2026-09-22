import os
from datetime import datetime
from openpyxl import Workbook
from core.config import REPORTS_DIR
import db.mongo as db_module

async def _build_case_report_xlsx(case_doc: dict) -> tuple[str, str]:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Thông tin vụ án"

    def _fmt_dt(dt):
        return dt.strftime("%d/%m/%Y %H:%M") if isinstance(dt, datetime) else ""

    n_detainees = await db_module.db.detainees.count_documents({"case_id": case_doc["_id"]})
    n_traces = await db_module.db.scene_traces.count_documents({"case_id": case_doc["_id"]})
    rows = [
        ["PHIẾU BÁO CÁO VỤ ÁN"],
        [],
        ["Mã vụ án:", case_doc.get("code", "")],
        ["Tên vụ án:", case_doc.get("name", "") or ""],
        ["Cán bộ phụ trách:", case_doc.get("officer_name", "") or ""],
        ["Quân hàm:", case_doc.get("officer_rank", "") or ""],
        ["Địa điểm:", case_doc.get("location", "") or ""],
        ["Thời gian xảy ra:", _fmt_dt(case_doc.get("occurred_at"))],
        ["Trạng thái:", "Đã kết thúc" if case_doc.get("status") == "closed" else "Đang điều tra"],
        ["Ghi chú:", case_doc.get("note", "") or ""],
        ["Lập hồ sơ lúc:", _fmt_dt(case_doc.get("created_at"))],
        ["Kết thúc lúc:", _fmt_dt(case_doc.get("closed_at"))],
        ["Tổng hồ sơ:", n_detainees],
        ["Tổng dấu vết:", n_traces],
    ]
    for r in rows:
        ws1.append(r)
    ws1.column_dimensions["A"].width = 18
    ws1.column_dimensions["B"].width = 42

    ws2 = wb.create_sheet("Danh sách hồ sơ")
    headers = ["STT", "Số định danh", "Họ và tên", "Giới tính", "Ngày sinh", "Số CCCD", "Quê quán", "Buồng", "Ghi chú"]
    ws2.append(headers)
    i = 0
    async for d in db_module.db.detainees.find({"case_id": case_doc["_id"]}).sort("created_at", 1):
        i += 1
        dob_str = d.get("dob") or ""
        gender = "Nam" if d.get("gender") == "male" else "Nữ"
        ws2.append([
            i,
            d.get("personal_id", "") or d.get("cccd_number", "") or "",
            d.get("full_name", ""),
            gender,
            dob_str,
            d.get("cccd_number", "") or "",
            d.get("hometown", "") or "",
            d.get("cell_code", "") or "",
            d.get("note", "") or "",
        ])
    for col in ws2.columns:
        letter = col[0].column_letter
        ws2.column_dimensions[letter].width = 18

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"case_{case_doc.get('code','')}_{ts}.xlsx"
    filepath = os.path.join(REPORTS_DIR, filename)
    wb.save(filepath)
    return filepath, filename
