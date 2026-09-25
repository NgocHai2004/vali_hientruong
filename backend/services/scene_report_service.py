import os
import re
import io
import base64
import asyncio
import uuid
from html import escape
from fastapi import HTTPException
from datetime import datetime
from typing import Optional, Dict, Any, List
from bson import ObjectId
from PIL import Image, ImageDraw, ImageOps

# Chromium executable search
CHROMIUM_PATHS = [
    os.getenv("CHROME_PATH", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

FINGER_NAMES_VI = {
    "right_thumb": "Cái phải",
    "right_index": "Trỏ phải",
    "right_middle": "Giữa phải",
    "right_ring": "Áp út phải",
    "right_little": "Út phải",
    "left_thumb": "Cái trái",
    "left_index": "Trỏ trái",
    "left_middle": "Giữa trái",
    "left_ring": "Áp út trái",
    "left_little": "Út trái",
}

FP_KEY_BY_CODE = {
    "left_thumb": "fp_l1", "left_index": "fp_l2", "left_middle": "fp_l3",
    "left_ring": "fp_l4", "left_little": "fp_l5",
    "right_thumb": "fp_r1", "right_index": "fp_r2", "right_middle": "fp_r3",
    "right_ring": "fp_r4", "right_little": "fp_r5",
}


def find_chromium_executable() -> Optional[str]:
    for p in CHROMIUM_PATHS:
        if p and os.path.isfile(p):
            return p
    return None


# Giu 1 tien trinh Chromium headless song san, dung lai cho moi lan in PDF thay vi
# spawn tien trinh moi moi lan (tiet kiem ~2s khoi dong Chromium moi lan export).
_pw_ctx = None
_pw_browser = None
_pw_lock = asyncio.Lock()


async def _get_report_browser():
    global _pw_ctx, _pw_browser
    if _pw_browser is not None and _pw_browser.is_connected():
        return _pw_browser
    async with _pw_lock:
        if _pw_browser is not None and _pw_browser.is_connected():
            return _pw_browser
        chromium_path = find_chromium_executable()
        if not chromium_path:
            raise RuntimeError("Không tìm thấy trình duyệt Chromium/Edge để tạo file PDF trên máy chủ.")
        from playwright.async_api import async_playwright
        if _pw_ctx is None:
            _pw_ctx = await async_playwright().start()
        _pw_browser = await _pw_ctx.chromium.launch(
            executable_path=chromium_path,
            headless=True,
            args=["--disable-gpu"],
        )
        return _pw_browser


async def close_report_browser():
    """Goi khi tat server de dong sach tien trinh Chromium con giu san."""
    global _pw_ctx, _pw_browser
    if _pw_browser is not None:
        await _pw_browser.close()
        _pw_browser = None
    if _pw_ctx is not None:
        await _pw_ctx.stop()
        _pw_ctx = None


def _oid(id_str: Any) -> Any:
    if isinstance(id_str, ObjectId):
        return id_str
    try:
        return ObjectId(str(id_str))
    except Exception:
        return id_str


def _case_id_query(case_doc_or_id: Any) -> dict:
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


def _resolve_file_path(url: str, upload_dir: str) -> Optional[str]:
    if not url:
        return None
    if url.startswith("data:"):
        return None
    if os.path.isabs(url) and os.path.isfile(url):
        return url
    if url.startswith("/uploads/"):
        rel = url[len("/uploads/"):]
        path = os.path.join(upload_dir, rel.replace("/", os.sep))
        return path if os.path.isfile(path) else None
    if url.startswith("uploads/"):
        rel = url[len("uploads/"):]
        path = os.path.join(upload_dir, rel.replace("/", os.sep))
        return path if os.path.isfile(path) else None
    fname = os.path.basename(url)
    p1 = os.path.join(upload_dir, "scene", fname)
    if os.path.isfile(p1):
        return p1
    p2 = os.path.join(upload_dir, fname)
    if os.path.isfile(p2):
        return p2
    return None


def file_to_report_data_url(path: Optional[str], dots: Optional[List[dict]] = None, color: str = "#ec4899") -> str:
    """Build a compact report image and rasterize real landmarks onto it."""
    if not path or not os.path.isfile(path):
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    try:
        with Image.open(path) as opened:
            image = ImageOps.exif_transpose(opened)
            if "A" in image.getbands():
                rgba = image.convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                image = Image.alpha_composite(background, rgba).convert("L")
            else:
                image = image.convert("L")

            # 108 mm at roughly 150 DPI is about 638 px. More pixels only add
            # decode work for PDF readers without improving the printed report.
            image.thumbnail((640, 600), Image.Resampling.LANCZOS)
            image = image.convert("RGB")

            if dots:
                draw = ImageDraw.Draw(image)
                radius = max(2, round(min(image.size) * 0.004))
                for dot in dots:
                    x = float(dot["x"]) * image.width / 100.0
                    y = float(dot["y"]) * image.height / 100.0
                    draw.ellipse((x - radius - 2, y - radius - 2, x + radius + 2, y + radius + 2), fill="#111827")
                    draw.ellipse((x - radius - 1, y - radius - 1, x + radius + 1, y + radius + 1), fill="white")
                    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)

            output = io.BytesIO()
            # Baseline JPEG decodes faster than progressive JPEG in local PDF viewers.
            image.save(output, format="JPEG", quality=82, optimize=True, progressive=False, subsampling=0)
            b64 = base64.b64encode(output.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{b64}"
    except Exception:
        # Do not block report generation for an uncommon/partially corrupt image.
        ext = os.path.splitext(path)[1].lower()
        mime = "image/png" if ext == ".png" else "image/jpeg"
        try:
            with open(path, "rb") as source:
                b64 = base64.b64encode(source.read()).decode("ascii")
            return f"data:{mime};base64,{b64}"
        except OSError:
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


def _points_to_dots(points: list, w: int, h: int) -> List[dict]:
    if not points or w <= 0 or h <= 0:
        return []
    dots = []
    for pt in points:
        px, py = 0, 0
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            px, py = pt[0], pt[1]
        elif isinstance(pt, dict):
            px, py = pt.get("x", 0), pt.get("y", 0)
        else:
            continue
        cx = (float(px) / float(w)) * 100.0
        cy = (float(py) / float(h)) * 100.0
        if 0 <= cx <= 100 and 0 <= cy <= 100:
            dots.append({"x": round(cx, 1), "y": round(cy, 1), "is_mock": False})
    return dots


def field_val(val: Any, is_mock: bool = False, label: str = "Dữ liệu giả lập") -> dict:
    return {
        "val": val,
        "is_mock": bool(is_mock),
        "label": label if is_mock else "",
    }


async def build_scene_report_data(
    db,
    case_id: str,
    scope: str = "all",
    match_id: Optional[str] = None,
    current_user: Optional[dict] = None,
    upload_dir: str = "",
) -> dict:
    case_doc = await db.cases.find_one({"_id": _oid(case_id)}) if case_id else None
    if not case_doc:
        raise HTTPException(404, "Không tìm thấy vụ án để lập báo cáo")

    cid_q = _case_id_query(case_doc)

    # 1. Traces
    traces = [t async for t in db.scene_traces.find({"case_id": cid_q}).sort("seq", 1)]
    # 2. Detainees
    detainees = [d async for d in db.detainees.find({"case_id": cid_q}).sort("created_at", 1)]
    # 3. Matches
    matches_q = {"case_id": cid_q, "verdict": "match"}
    if match_id:
        matches_q["_id"] = _oid(match_id)
    matched_candidates = [m async for m in db.scene_matches.find(matches_q).sort("score", -1)]

    # Báo cáo chỉ trình bày một kết quả tốt nhất cho mỗi dấu vết đầu vào.
    # Không phụ thuộc vào thứ tự cursor để vẫn đúng khi dữ liệu cũ chưa được sắp xếp.
    best_match_by_trace = {}
    for candidate in matched_candidates:
        trace_key = str(candidate.get("trace_id") or candidate.get("_id"))
        current = best_match_by_trace.get(trace_key)
        if current is None or float(candidate.get("score") or 0) > float(current.get("score") or 0):
            best_match_by_trace[trace_key] = candidate
    matches = sorted(
        best_match_by_trace.values(),
        key=lambda item: float(item.get("score") or 0),
        reverse=True,
    )

    # Detainee lookup
    det_map = {str(d["_id"]): d for d in detainees}
    trace_map = {str(t["_id"]): t for t in traces}

    # Count enrolled FPs across detainees
    total_enrolled_fps = 0
    for d in detainees:
        photos = d.get("photos") or {}
        for fp_k in FP_KEY_BY_CODE.values():
            if photos.get(fp_k):
                total_enrolled_fps += 1

    # Date string
    now = datetime.now()
    date_str = f"Hà Nội, ngày {now.day:02d} tháng {now.month:02d} năm {now.year}"

    # Overview Fields
    unit_val = "C09"
    unit_is_mock = False

    # Author
    author_name = (current_user.get("full_name") if current_user else None) or "HTI GROUP HABIS Professional Technical Team"
    author_is_mock = current_user is None or not bool(current_user.get("full_name"))

    # Counts
    match_count_val = len(matches)
    total_lt_val = len(traces)
    total_tp_val = total_enrolled_fps
    
    total_pairs_num = total_lt_val * total_tp_val
    total_pairs_formatted = f"{total_pairs_num:,}".replace(",", ".")

    # Time measurements
    traces_with_created = [t for t in traces if t.get("created_at")]
    traces_with_matched = [t for t in traces if t.get("matched_at")]

    if traces_with_created:
        min_created = min(t["created_at"] for t in traces_with_created)
        date_received = f"{min_created.day:02d}/{min_created.month:02d}/{min_created.year}"
        date_received_is_mock = False
    else:
        date_received = "15/07/2026"
        date_received_is_mock = True

    if traces_with_matched:
        max_matched = max(t["matched_at"] for t in traces_with_matched)
        date_finished = f"{max_matched.day:02d}/{max_matched.month:02d}/{max_matched.year}"
        date_finished_is_mock = False
    else:
        date_finished = "21/07/2026"
        date_finished_is_mock = True

    # Assemble pairs for Phụ lục A
    pairs_data = []
    if matches:
        for idx, m in enumerate(matches):
            tid = str(m.get("trace_id", ""))
            did = str(m.get("detainee_id", ""))
            tr = trace_map.get(tid) or {}
            det = det_map.get(did) or {}

            seq = tr.get("seq") or (idx + 1)
            captured_at = tr.get("captured_at")
            captured_year = (str(captured_at)[:4] if captured_at else "")
            has_trace_identity = bool(tr.get("seq") is not None and captured_year.isdigit() and len(captured_year) == 4)
            # Same identifier as the trace panel: derived from real captured_at + seq.
            trace_code = tr.get("code") or f"DVHT-{captured_year if has_trace_identity else now.year}-{seq:04d}"
            trace_is_mock = not bool(tr.get("code") or has_trace_identity)

            cand_name = m.get("detainee_name") or det.get("full_name") or "Nguyễn Ngọc Hải"
            finger_raw = m.get("finger_code") or "right_index"
            finger_vi = FINGER_NAMES_VI.get(finger_raw, finger_raw)
            ref_code = f"{cand_name}_{finger_vi}"

            latent_url = tr.get("url") or ""
            latent_path = _resolve_file_path(latent_url, upload_dir)

            photos = det.get("photos") or {}
            fp_k = FP_KEY_BY_CODE.get(finger_raw, "fp_r2")
            cand_url = photos.get(fp_k) or ""
            cand_path = _resolve_file_path(cand_url, upload_dir)

            # Dots
            l_lm = tr.get("landmark") or {}
            l_pts = l_lm.get("points") if isinstance(l_lm, dict) else (l_lm if isinstance(l_lm, list) else [])
            l_w = tr.get("img_width") or 800
            l_h = tr.get("img_height") or 750
            latent_dots = _points_to_dots(l_pts, l_w, l_h) if l_pts else []

            det_lms = det.get("fp_landmarks") or {}
            c_lm_obj = det_lms.get(finger_raw) or {}
            c_pts = c_lm_obj.get("landmark", {}).get("points") if isinstance(c_lm_obj, dict) else []
            c_w = c_lm_obj.get("img_width") or 800
            c_h = c_lm_obj.get("img_height") or 750
            cand_dots = _points_to_dots(c_pts, c_w, c_h) if c_pts else []

            # PDF receives one optimized bitmap per fingerprint. Real landmarks
            # are burned into the derivative image; source evidence stays intact.
            latent_b64 = file_to_report_data_url(latent_path, latent_dots, "#ec4899")
            cand_b64 = file_to_report_data_url(cand_path, cand_dots, "#ec4899")

            pairs_data.append({
                "figure_num": idx + 1,
                "trace_code": field_val(trace_code, trace_is_mock),
                "ref_code": field_val(ref_code, not bool(m.get("detainee_name") or det.get("full_name")) or not bool(m.get("finger_code"))),
                "cand_name": cand_name,
                "finger_name": finger_vi,
                "latent_img": latent_b64,
                "cand_img": cand_b64,
            })

    return {
        "case_code": case_doc.get("code", "VA-2026-0001"),
        "case_name": case_doc.get("name", ""),
        "date_str": date_str,
        "unit": field_val(unit_val, unit_is_mock),
        "author": field_val(author_name, author_is_mock),
        "match_count": field_val(match_count_val, False),
        "total_lt": field_val(total_lt_val, False),
        "total_tp": field_val(total_tp_val, False),
        "total_pairs": field_val(total_pairs_formatted, False),
        "date_received": field_val(date_received, date_received_is_mock),
        "date_finished": field_val(date_finished, date_finished_is_mock),
        "pairs": pairs_data,
    }


def render_html_report(data: dict) -> str:
    """Renders the HTML template matching our A4 Portrait specification."""
    def render_field(f: dict) -> str:
        val = escape(str(f.get("val", "")), quote=True)
        if f.get("is_mock"):
            label = escape(str(f.get("label", "Dữ liệu giả lập")), quote=True)
            return f'<span class="mock-data" title="{label}">{val} <span class="mock-tag">[{label}]</span></span>'
        return val

    def render_pair(p: dict) -> str:
        fig_num = int(p["figure_num"])
        tr_code = render_field(p["trace_code"])
        rf_code = render_field(p["ref_code"])
        return f"""
            <div class="sr-figure">
              <div class="sr-figure-title">
                Figure {fig_num}. Dấu vết tiềm ẩn {tr_code} - trùng khớp dấu vân tham chiếu {rf_code}
              </div>
              <div class="sr-match-card-wrap">
                <div class="sr-match-card">
                  <div class="sr-match-col">
                    <div class="sr-match-img-box">
                      <img src="{escape(p['latent_img'], quote=True)}" alt="Latent" />
                    </div>
                    <div class="sr-match-label">Ảnh hiện trường: {tr_code}</div>
                  </div>
                  <div class="sr-match-divider" aria-hidden="true">
                    <span class="sr-match-line"></span>
                    <span class="sr-match-vs">vs</span>
                    <span class="sr-match-line"></span>
                  </div>
                  <div class="sr-match-col">
                    <div class="sr-match-img-box">
                      <img src="{escape(p['cand_img'], quote=True)}" alt="Candidate" />
                    </div>
                    <div class="sr-match-label">Ảnh đối sánh: {rf_code}</div>
                  </div>
                </div>
              </div>
            </div>
        """

    # Trang A4 dọc: trang đầu phụ lục có phần giới thiệu nên chỉ xếp 1 cặp,
    # các trang sau xếp 2 cặp/trang để không bỏ trống nửa trang khi in.
    pairs = data.get("pairs", [])
    first_page_pairs = 1
    pairs_per_page = 2
    pair_pages = []
    if pairs:
        pair_pages.append(pairs[:first_page_pairs])
        pair_pages.extend(
            pairs[i:i + pairs_per_page] for i in range(first_page_pairs, len(pairs), pairs_per_page)
        )

    pairs_html = []
    for idx, page_pairs in enumerate(pair_pages):
        intro_block = ""
        if idx == 0:
            intro_block = f"""
            <div class="sr-appendix-intro-block">
              <div class="sr-appendix-main-title">
                PHỤ LỤC A. HÌNH ẢNH CÁC CẶP DẤU VÂN TAY ĐƯỢC XÁC ĐỊNH TRÙNG KHỚP
              </div>
              <p class="sr-text">
                Vụ án có {int(data['total_lt']['val'])} ảnh dấu vết hiện trường; phụ lục trình bày {len(data.get('pairs', []))} cặp đối sánh trùng khớp. Một ảnh hiện trường có thể xuất hiện trong nhiều cặp với các dấu vân tham chiếu khác nhau.
              </p>
              <p class="sr-text">
                Các hình ảnh dưới đây thể hiện các cặp dấu vết tiềm ẩn (latent impressions) và dấu vân tham chiếu tương ứng (reference impressions) được ghi nhận trong danh sách kết quả. Ảnh bên trái thể hiện dấu vết hiện trường; ảnh bên phải thể hiện dấu vân tham chiếu trên giao diện Verification.
              </p>
              <p class="sr-text">
                Các điểm đánh dấu thể hiện đặc trưng do hệ thống trích xuất trên từng ảnh và chưa xác nhận việc chuyên gia thẩm định. Ảnh không có dữ liệu đặc trưng sẽ được hiển thị nguyên bản, không bổ sung điểm đánh dấu.
              </p>
              <p class="sr-text">
                Các nhãn hoặc mã số hiển thị trên hình ảnh hiện là mã định danh làm việc và có thể được thay thế bằng số hiệu vật chứng chính thức của Bộ Công an trong phiên bản báo cáo chính thức.
              </p>
            </div>
            """

        figures_html = "\n".join(render_pair(p) for p in page_pairs)
        pairs_html.append(f"""
        <div class="sr-page-a4 sr-appendix-page">
          <div class="sr-section">
            {intro_block}
            {figures_html}
          </div>
          <div class="sr-page-footer">
            <div class="sr-sec-notice">
              <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
            </div>
            <div class="sr-page-num">{6 + idx}</div>
          </div>
        </div>
        """)

    all_pairs_str = "\n".join(pairs_html)
    if not all_pairs_str:
        all_pairs_str = """
        <div class="sr-page-a4 sr-appendix-page">
          <div class="sr-section">
            <div class="sr-appendix-main-title">PHỤ LỤC A. HÌNH ẢNH CÁC CẶP DẤU VÂN TAY ĐƯỢC XÁC ĐỊNH TRÙNG KHỚP</div>
            <p class="sr-text">Không có dữ liệu đối sánh nào.</p>
          </div>
          <div class="sr-page-footer">
            <div class="sr-sec-notice">
              <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
            </div>
            <div class="sr-page-num">6</div>
          </div>
        </div>
        """

    unit_rendered = render_field(data["unit"])
    author_rendered = render_field(data["author"])
    match_count_rendered = render_field(data["match_count"])
    total_lt_rendered = render_field(data["total_lt"])
    total_tp_rendered = render_field(data["total_tp"])
    total_pairs_rendered = render_field(data["total_pairs"])
    date_received_rendered = render_field(data["date_received"])
    date_finished_rendered = render_field(data["date_finished"])

    raw_total_all = (data["total_lt"]["val"] or 0) + (data["total_tp"]["val"] or 0)

    html = f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Báo cáo kết quả đối sánh vân tay - {escape(str(data['case_code']))}</title>
  <style>
    @page {{
      size: A4 portrait;
      margin: 0;
    }}
    * {{
      box-sizing: border-box;
    }}
    body {{
      margin: 0;
      padding: 0;
      background: #e2e8f0;
      color: #000000;
      font-family: "Times New Roman", Times, "Liberation Serif", serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }}
    .sr-page-a4 {{
      width: 210mm;
      height: 297mm;
      min-height: 297mm;
      max-height: 297mm;
      max-width: 210mm;
      background: #ffffff;
      padding: 15mm 15mm 36mm 15mm;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      margin: 0 auto;
      page-break-after: always;
      break-after: page;
    }}
    .sr-auto-body {{
      display: flow-root;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }}
    .sr-flow-group {{
      display: flow-root;
    }}
    .sr-split-list {{
      margin-top: 0 !important;
      margin-bottom: 0 !important;
    }}
    @media screen {{
      .sr-page-a4 {{
        margin-bottom: 20px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      }}
    }}
    .sr-page-footer {{
      position: absolute;
      bottom: 8mm;
      left: 15mm;
      right: 15mm;
    }}
    .sr-sec-notice {{
      font-size: 9pt;
      line-height: 1.3;
      text-align: justify;
      margin-bottom: 2px;
      color: #000000;
    }}
    .sr-sec-notice-tag {{
      color: #003865;
      font-weight: 700;
    }}
    .sr-page-num {{
      font-size: 10pt;
      text-align: right;
      color: #000000;
      line-height: 1.2;
      margin: 0;
    }}
    .sr-header-top {{
      width: 100%;
      margin: 0 0 10px 0;
    }}
    .sr-org-title {{
      font-size: 14pt;
      font-weight: 700;
      color: #003865;
      letter-spacing: 0.5px;
      margin: 0 0 3px 0;
      line-height: 1.2;
      text-transform: uppercase;
    }}
    .sr-header-line {{
      width: 100%;
      height: 3.5px;
      background: #003865;
      border: none;
      margin: 0;
    }}
    .sr-title-block {{
      text-align: center;
      margin: 6px 0 8px 0;
      width: 100%;
    }}
    .sr-main-title {{
      font-size: 20pt;
      font-weight: 700;
      color: #003865;
      text-transform: uppercase;
      margin: 0 0 3px 0;
      letter-spacing: 0.4px;
      line-height: 1.25;
    }}
    .sr-eng-title {{
      font-size: 14pt;
      font-weight: 400;
      color: #505050;
      margin: 0 0 4px 0;
      line-height: 1.3;
    }}
    .sr-date-loc {{
      font-size: 14pt;
      color: #000000;
      text-align: right;
      margin: 2px 0 8px 0;
    }}
    .sr-section {{
      width: 100%;
      margin-bottom: 6px;
    }}
    .sr-section-h {{
      font-size: 14pt;
      font-weight: 700;
      color: #000000;
      text-transform: uppercase;
      margin: 22px 0 8px 0;
      line-height: 1.3;
    }}
    .sr-field-line {{
      font-size: 14pt;
      line-height: 1.35;
      color: #000000;
      margin-bottom: 2px;
    }}
    .sr-sub-title {{
      font-size: 14pt;
      font-weight: 700;
      color: #000000;
      margin: 6px 0 2px 0;
      line-height: 1.3;
    }}
    .sr-text {{
      font-size: 13.6pt;
      line-height: 1.35;
      color: #000000;
      margin: 0 0 4px 0;
      text-align: justify;
    }}
    .sr-dash-list {{
      list-style: none;
      margin: 2px 0 5px 0;
      padding: 0 0 0 20px;
      font-size: 13.6pt;
      line-height: 1.35;
      color: #000000;
    }}
    .sr-dash-list li {{
      position: relative;
      padding-left: 14px;
      margin-bottom: 2px;
    }}
    .sr-dash-list li::before {{
      content: "- ";
      position: absolute;
      left: 0;
      font-weight: 400;
    }}
    .sr-bullet-list {{
      list-style: none;
      margin: 2px 0 5px 0;
      padding: 0;
      font-size: 13.6pt;
      line-height: 1.35;
      color: #000000;
      text-align: justify;
    }}
    .sr-bullet-list li {{
      position: relative;
      padding-left: 18px;
      margin-bottom: 4px;
    }}
    .sr-bullet-list li::before {{
      content: "● ";
      position: absolute;
      left: 0;
      top: 0;
      font-size: 10pt;
      color: #000000;
    }}
    .sr-appendix-intro-block {{
      margin-bottom: 4px;
    }}
    .sr-appendix-main-title {{
      font-size: 14pt;
      font-weight: 700;
      color: #000000;
      text-transform: uppercase;
      text-align: center;
      margin: 0 0 5px 0;
      letter-spacing: 0.3px;
      line-height: 1.3;
    }}
    .sr-figure {{
      margin-bottom: 8mm;
      break-inside: avoid;
    }}
    .sr-figure-title {{
      font-size: 12pt;
      font-style: italic;
      text-align: center;
      color: #505050;
      margin: 4px 0 6px 0;
    }}
    .sr-match-card-wrap {{
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      margin: 2px 0 4px 0;
    }}
    .sr-match-card {{
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      background: #ffffff;
      border: none;
      padding: 4px 0;
    }}
    .sr-match-col {{
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
    }}
    .sr-match-img-box {{
      position: relative;
      width: 100%;
      height: 82mm;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .sr-match-img-box img {{
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }}
    .sr-match-divider {{
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 35mm;
      flex-shrink: 0;
      margin: 0 6px 18px 6px;
    }}
    .sr-match-line {{
      width: 1px;
      flex: 1;
      background: #cbd5e1;
      margin: 3px 0;
    }}
    .sr-match-vs {{
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11pt;
      font-weight: 700;
      color: #64748b;
      text-transform: lowercase;
      padding: 2px 0;
      line-height: 1;
    }}
    .sr-match-label {{
      margin-top: 5px;
      font-size: 10pt;
      font-weight: normal;
      font-style: italic;
      color: #000000;
      text-align: center;
      line-height: 1.3;
      width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    /* Mock data highlight in red */
    .mock-data {{
      color: #dc2626 !important;
      font-weight: inherit;
    }}
    .mock-tag {{
      font-size: 0.8em;
      color: #dc2626 !important;
      font-weight: normal;
      margin-left: 2px;
    }}
  </style>
</head>
<body>

  <!-- ==================== PAGE 1 ==================== -->
  <div class="sr-page-a4">
    <div class="sr-header-top">
      <div class="sr-org-title">HTI GROUP</div>
      <div class="sr-header-line"></div>
    </div>

    <div class="sr-title-block">
      <div class="sr-main-title">BÁO CÁO KẾT QUẢ SO SÁNH KĨ THUẬT HÌNH SỰ</div>
      <div class="sr-eng-title">HTI-HABIS&AFIS Latent Fingerprint Search & Identification</div>
      <div class="sr-date-loc">{escape(str(data['date_str']))}</div>
    </div>

    <div class="sr-section">
      <div class="sr-section-h">1. OVERVIEW:</div>
      <div class="sr-field-line"><strong>Đơn vị:</strong> {unit_rendered}</div>
      <div class="sr-field-line"><strong>Người lập báo cáo:</strong> {author_rendered}</div>
      <div class="sr-field-line"><strong>Subject:</strong> Tổng hợp kết quả đối sánh dấu vân hiện trường với dữ liệu dấu vân tham chiếu kỹ thuật số</div>
      <div class="sr-field-line"><strong>Result summary:</strong> {match_count_rendered} bản ghi đối sánh được liệt kê trong danh sách kết quả đã được xác nhận trùng khớp</div>
    </div>

    <div class="sr-section">
      <div class="sr-section-h">2. TÓM TẮT QUÁ TRÌNH VÀ KẾT QUẢ XỬ LÝ – PHASE 3</div>
      <div class="sr-sub-title">Dữ liệu tiếp nhận:</div>
      <p class="sr-text">HTI GROUP tiếp nhận tổng cộng {raw_total_all} ảnh dữ liệu dấu vân, bao gồm:</p>
      <ul class="sr-dash-list">
        <li>{total_tp_rendered} ảnh vân tay tham chiếu (Tenprint – TP);</li>
        <li>{total_lt_rendered} ảnh vân tay dấu vết hiện trường (Latent – LT).</li>
        <li>Tổng số dữ liệu phục vụ đối sánh gồm {total_tp_rendered} ảnh vân tay TP và {total_lt_rendered} ảnh LT.</li>
      </ul>
    </div>

    <div class="sr-page-footer">
      <div class="sr-sec-notice">
        <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
      </div>
      <div class="sr-page-num">1</div>
    </div>
  </div>

  <!-- ==================== PAGE 2 ==================== -->
  <div class="sr-page-a4">
    <div class="sr-section">
      <div class="sr-sub-title">Quy mô đối sánh:</div>
      <ul class="sr-dash-list">
        <li>
          {total_lt_rendered} LT × {total_tp_rendered} TP, tương ứng tối đa {total_pairs_rendered} cặp đối sánh LT–TP, trong trường hợp mỗi dấu vết LT được tìm kiếm trên toàn bộ tập dữ liệu TP.
        </li>
      </ul>

      <div class="sr-sub-title">Quá trình xử lý:</div>
      <p class="sr-text">
        Các ảnh TP và LT được đăng ký, tiền xử lý và trích xuất đặc trưng trên hệ thống HABIS. Đối với dữ liệu LT, hệ thống thực hiện phân tích vùng dấu có giá trị, hướng đường vân (ridge flow), vùng kiểu hình (pattern area), các điểm đặc trưng (minutiae/characteristic points) và 121 thuật toán còn lại sử dụng trí tuệ nhân tạo. Sau khi trích xuất đặc trưng, từng LT được tìm kiếm trên tập dữ liệu TP để truy xuất và xếp hạng các ứng viên có mức độ tương thích cao, sau đó thực hiện kiểm tra và đối chiếu trên giao diện xác minh.
      </p>

      <div class="sr-sub-title">Kết quả đối sánh:</div>
      <p class="sr-text">
        Qua quá trình tìm kiếm, truy xuất ứng viên và kiểm tra kết quả, hệ thống ghi nhận {match_count_rendered} cặp đối sánh trùng khớp. Các cặp kết quả được tổng hợp và trình bày kèm hình ảnh đối chiếu trong phụ lục báo cáo để phục vụ quá trình xem xét và xác minh chuyên môn.
      </p>

      <div class="sr-sub-title">Thời gian thực hiện:</div>
      <ul class="sr-dash-list">
        <li>Ngày tiếp nhận mẫu: {date_received_rendered}</li>
        <li>Thời điểm hoàn thành xử lý: ngày {date_finished_rendered}</li>
      </ul>
    </div>

    <div class="sr-page-footer">
      <div class="sr-sec-notice">
        <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
      </div>
      <div class="sr-page-num">2</div>
    </div>
  </div>

  <!-- ==================== PAGE 3 ==================== -->
  <div class="sr-page-a4">
    <div class="sr-section">
      <div class="sr-section-h">3. QUÁ TRÌNH THỰC HIỆN</div>
      <ul class="sr-bullet-list">
        <li>
          <strong>Đăng ký ảnh và tiền xử lý:</strong> Các ảnh dấu vết hiện trường (latent) và dữ liệu dấu vân tham chiếu được đưa vào môi trường làm việc của HABIS để đăng ký (registration), chuẩn hóa và căn chỉnh trước khi thực hiện tìm kiếm, đối sánh. Trong bước này, hệ thống xác định vùng dấu có giá trị, điều chỉnh hướng hiển thị phù hợp và chuẩn bị dữ liệu đầu vào nhằm bảo đảm các đặc điểm đường vân có thể được phân tích một cách nhất quán trong các bước tiếp theo.
        </li>
        <li>
          <strong>Phân tích đặc điểm dấu vết:</strong> Hệ thống tiến hành phân tích hướng đường vân (ridge flow), vùng kiểu hình (pattern area), các điểm đặc trưng/phút chi tiết (minutiae/characteristic points) và mối quan hệ cục bộ giữa các đường vân. Đối với các dấu vết hiện trường chỉ thể hiện một phần, có độ tương phản thấp, bị mờ hoặc chịu ảnh hưởng của bề mặt mang dấu, công nghệ AI được sử dụng để tự động xác định vùng có giá trị, trích xuất các đặc điểm có khả năng phục vụ nhận dạng và tạo dữ liệu đặc trưng phục vụ quá trình tìm kiếm.
        </li>
        <li>
          <strong>Truy xuất và xếp hạng ứng viên bằng HABIS:</strong> Trên cơ sở tập hợp đặc trưng đã được trích xuất từ dấu vết truy vấn, HABIS thực hiện tìm kiếm trong tập dữ liệu dấu vân đã biết, đánh giá mức độ tương thích và xếp hạng các ứng viên có khả năng phù hợp. Kết quả tìm kiếm được cung cấp dưới dạng danh sách ứng viên để hỗ trợ người sử dụng nhanh chóng tập trung vào các bản ghi có mức độ tương đồng cao, thay vì phải kiểm tra thủ công toàn bộ dữ liệu tham chiếu.
        </li>
        <li>
          <strong>Đối chiếu song song và xác minh:</strong> Các cặp dấu vết được lựa chọn từ danh sách ứng viên được hiển thị theo phương thức so sánh song song (side-by-side), cho phép rà soát trực tiếp dấu vết hiện trường và dấu vân tham chiếu. Quá trình kiểm tra tập trung vào sự tương ứng của các điểm đặc trưng, hướng phát triển của đường vân, vị trí tương đối giữa các đặc điểm, cấu trúc cục bộ của vùng dấu và các điểm khác biệt có thể quan sát được trong vùng có giá trị so sánh. Các điểm đặc trưng tương ứng được hiển thị trực quan trên giao diện nhằm hỗ trợ quá trình xem xét và xác minh kết quả.
        </li>
        <li>
          <strong>Đánh giá tính nhất quán của kết quả:</strong> Bên cạnh việc xác định các đặc điểm tương ứng, quá trình đánh giá còn xem xét sự nhất quán tổng thể của cấu trúc đường vân giữa dấu latent và dấu tham chiếu. Những khác biệt quan sát được cần được xem xét trong bối cảnh chất lượng ảnh, mức độ đầy đủ của dấu, biến dạng hoặc điều kiện hình thành dấu vết, qua đó hỗ trợ phân biệt giữa khác biệt có thể giải thích và khác biệt có ý nghĩa đối với kết quả đối sánh.
        </li>
      </ul>
    </div>

    <div class="sr-page-footer">
      <div class="sr-sec-notice">
        <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
      </div>
      <div class="sr-page-num">3</div>
    </div>
  </div>

  <!-- ==================== PAGE 4 ==================== -->
  <div class="sr-page-a4">
    <div class="sr-section">
      <ul class="sr-bullet-list">
        <li>
          <strong>Kết luận kỹ thuật:</strong> Các bản ghi được đưa vào phụ lục là những cặp đối sánh được ghi nhận trong danh sách kết quả sau quá trình tìm kiếm, xếp hạng và kiểm tra trên hệ thống. Mỗi kết quả đi kèm ảnh chụp giao diện đối chiếu, thể hiện dấu vết truy vấn, dấu vân tham chiếu và các điểm đặc trưng tương ứng, phục vụ việc xem xét, xác minh và làm cơ sở cho quá trình đánh giá chuyên môn tiếp theo.
        </li>
      </ul>

      <div class="sr-section-h">4. KẾT QUẢ CUỐI CÙNG</div>
      <p class="sr-text">
        Danh sách kết quả cung cấp {match_count_rendered} bản ghi đối sánh. Mỗi bản ghi bao gồm số thứ tự, mã ảnh hiện trường, vị trí ngón, mã ảnh người/dấu vân tham chiếu, ảnh chụp màn hình đối chiếu và quy tắc đặt tên ảnh.
      </p>

      <div class="sr-sub-title">Thông tin kỹ thuật của bộ kết quả:</div>
      <ul class="sr-dash-list">
        <li>
          <strong>Trích xuất đặc trưng dấu vân tay tham chiếu:</strong> thời gian xử lý trung bình khoảng 0,15 giây/01 dấu vân tay, tương đương khoảng 1,8 giây/01 hồ sơ đối tượng gồm 10 dấu vân tay và 02 dấu lòng bàn tay. Quá trình này thực hiện phân tích và mã hóa các đặc trưng sinh trắc học phục vụ tìm kiếm, đối sánh trên hệ thống HABIS.
        </li>
        <li>
          <strong>Trích xuất đặc trưng dấu vết hiện trường (latent):</strong> thời gian xử lý trung bình khoảng 6 giây/01 mẫu trong chế độ phân tích tự động; đối với các dấu vết có chất lượng thấp, không đầy đủ hoặc cần chuyên gia hiệu chỉnh vùng dấu và điểm đặc trưng, thời gian xử lý khoảng 45 giây/01 mẫu có tác động thủ công.
        </li>
        <li>
          <strong>Kết quả tìm kiếm và đối sánh:</strong> bộ kết quả mới ghi nhận {match_count_rendered} cặp đối sánh giữa dấu vết hiện trường và dấu vân tay tham chiếu, được hệ thống truy xuất, hiển thị và đối chiếu trên giao diện xác minh. Mỗi kết quả thể hiện dấu vết truy vấn, dấu tham chiếu tương ứng và các điểm đặc trưng được sử dụng để hỗ trợ đánh giá mức độ tương thích giữa hai mẫu.
        </li>
      </ul>
    </div>

    <div class="sr-page-footer">
      <div class="sr-sec-notice">
        <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
      </div>
      <div class="sr-page-num">4</div>
    </div>
  </div>

  <!-- ==================== PAGE 5 ==================== -->
  <div class="sr-page-a4">
    <div class="sr-section">
      <p class="sr-text" style="font-weight: 700; margin-bottom: 6px;">
        Lưu ý: Các số hiệu kết quả trình bày trong báo cáo này là mã định danh tạm thời được sử dụng cho mục đích lập báo cáo và đối chiếu kỹ thuật. Sau khi hồ sơ vụ án được hoàn thiện và số hiệu vật chứng chính thức được Bộ Công an xác nhận, các mã định danh này sẽ được thay thế tương ứng bằng số hiệu vật chứng chính thức được thiết lập trong cơ sở dữ liệu đồng bộ.
      </p>

      <div class="sr-section-h">5. Ý KIẾN CHUYÊN MÔN</div>
      <p class="sr-text">
        Trên cơ sở dữ liệu được cung cấp, HTI GROUP xác nhận bộ tài liệu hiện tại thể hiện {match_count_rendered} bản ghi được ghi nhận là đối sánh trùng khớp trong kết quả hệ thống và có minh chứng hình ảnh tương ứng. Các ảnh cho phép rà soát trực quan dấu vết hiện trường, dấu vân tham chiếu và các điểm đặc trưng được đánh dấu trên giao diện Verification.
      </p>
      <p class="sr-text">
        Kết quả kỹ thuật này phục vụ đánh giá hệ thống và hỗ trợ quá trình xác minh chuyên môn. Việc đưa kết quả vào hoạt động tố tụng, quản lý hành chính hoặc kết luận giám định chính thức cần được thực hiện theo quy trình nghiệp vụ, bao gồm xác nhận số hiệu vật chứng, chuỗi quản lý vật chứng (chain of custody), thẩm định độc lập (peer review) và phê duyệt của giám định viên có thẩm quyền.
      </p>

      <div class="sr-section-h">6. KIẾN NGHỊ CÁC BƯỚC TIẾP THEO</div>
      <ul class="sr-bullet-list">
        <li>
          <strong>Xác nhận định danh chính thức:</strong> Đối chiếu {match_count_rendered} bản ghi với số hiệu vật chứng/hồ sơ chính thức và xác nhận ánh xạ giữa mã ảnh hiện trường, vị trí ngón và bản ghi dấu vân tham chiếu.
        </li>
        <li>
          <strong>Thẩm định độc lập:</strong> Thực hiện peer review đối với các cặp đối sánh trước khi sử dụng làm kết luận giám định hoặc tài liệu nghiệp vụ chính thức.
        </li>
        <li>
          <strong>Hoàn thiện báo cáo giám định:</strong> Trường hợp sử dụng trong hồ sơ vụ án, bổ sung bảng đặc điểm nhận dạng, tọa độ/các điểm đặc trưng, thông tin vật chứng, chữ ký giám định viên và kết luận cuối cùng theo mẫu/quy trình hiện hành.
        </li>
        <li>
          <strong>Phân tích bổ sung khi cần:</strong> Đối với các dấu vết cần đánh giá sâu hơn, sử dụng ảnh nguồn có độ phân giải gốc và thực hiện tiền xử lý/đánh dấu chuyên gia để tăng khả năng kiểm tra và xác minh.
        </li>
        <li>
          <strong>Đánh giá năng lực hệ thống:</strong> Nếu bộ dữ liệu được dùng cho mục đích thử nghiệm/đánh giá, có thể lập thêm bảng thống kê về thời gian xử lý, thứ hạng ứng viên, điểm số đối sánh và tỷ lệ xác minh sau khi các thông số gốc được cung cấp đầy đủ.
        </li>
      </ul>
    </div>

    <div class="sr-page-footer">
      <div class="sr-sec-notice">
        <strong class="sr-sec-notice-tag">Thông báo bảo mật:</strong> Báo cáo này được lập nhằm phục vụ trao đổi kỹ thuật chuyên môn và đánh giá kết quả hệ thống. Nội dung được xây dựng trên cơ sở danh sách kết quả và các ảnh điện tử do HTI GROUP tiếp nhận từ đơn vị cung cấp. Việc nộp chứng cứ chính thức, xác nhận chuỗi bảo quản chứng cứ (chain of custody), thẩm định độc lập và xác lập giá trị pháp lý của chứng cứ phải được thực hiện theo quy trình nghiệp vụ của Bộ Công an.
      </div>
      <div class="sr-page-num">5</div>
    </div>
  </div>

  <!-- ==================== PAGE 6+: PHỤ LỤC A ==================== -->
  {all_pairs_str}

  <script>
    (() => {{
      const allPages = Array.from(document.querySelectorAll('.sr-page-a4'));
      const mainPages = allPages.filter((page) => !page.classList.contains('sr-appendix-page'));
      if (!mainPages.length) return;

      const firstMain = mainPages[0];
      const footerTemplate = firstMain.querySelector('.sr-page-footer');
      const blocks = [];

      const pushBlock = (element) => {{
        if (element.matches('ul, ol')) {{
          Array.from(element.children).forEach((item) => {{
            const list = element.cloneNode(false);
            list.classList.add('sr-split-list');
            list.appendChild(item.cloneNode(true));
            blocks.push(list);
          }});
          return;
        }}
        blocks.push(element.cloneNode(true));
      }};

      mainPages.forEach((page) => {{
        Array.from(page.children).forEach((child) => {{
          if (child.classList.contains('sr-page-footer')) return;
          if (child.classList.contains('sr-section')) {{
            Array.from(child.children).forEach(pushBlock);
          }} else {{
            pushBlock(child);
          }}
        }});
      }});

      const generated = [];
      let body = null;
      const newPage = () => {{
        const page = document.createElement('div');
        page.className = 'sr-page-a4 sr-auto-page';
        body = document.createElement('div');
        body.className = 'sr-auto-body';
        page.appendChild(body);
        if (footerTemplate) page.appendChild(footerTemplate.cloneNode(true));
        firstMain.parentNode.insertBefore(page, firstMain);
        generated.push(page);
      }};
      const fits = () => body.scrollHeight <= body.clientHeight + 1;
      const keepWithNext = (block) => block.matches(
        '.sr-header-top, .sr-section-h, .sr-sub-title'
      );

      newPage();
      for (let index = 0; index < blocks.length; index += 1) {{
        let block = blocks[index];
        if (keepWithNext(block) && blocks[index + 1]) {{
          const group = document.createElement('div');
          group.className = 'sr-flow-group';
          group.appendChild(block);
          group.appendChild(blocks[index + 1]);
          block = group;
          index += 1;
        }}

        body.appendChild(block);
        if (!fits() && body.children.length > 1) {{
          body.removeChild(block);
          newPage();
          body.appendChild(block);
        }}
      }}

      mainPages.forEach((page) => page.remove());
      Array.from(document.querySelectorAll('.sr-page-a4')).forEach((page, index) => {{
        const number = page.querySelector('.sr-page-num');
        if (number) number.textContent = String(index + 1);
      }});
      document.documentElement.dataset.paginationReady = 'true';
    }})();
  </script>

</body>
</html>
"""
    return html


async def generate_scene_report_pdf(
    db,
    case_id: str,
    scope: str = "all",
    match_id: Optional[str] = None,
    current_user: Optional[dict] = None,
    upload_dir: str = "",
    reports_dir: str = "",
    report_data: Optional[dict] = None,
) -> str:
    """Generates PDF using a warm headless Chromium (Edge) instance, returns path to created PDF file."""
    os.makedirs(reports_dir, exist_ok=True)
    report_data = report_data if report_data is not None else await build_scene_report_data(
        db, case_id=case_id, scope=scope, match_id=match_id,
        current_user=current_user, upload_dir=upload_dir,
    )
    html_content = render_html_report(report_data)

    case_code_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", report_data.get("case_code", "report")).strip("_")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_filename = f"Bao_cao_doi_sanh_{case_code_safe}_{ts}_{uuid.uuid4().hex}.pdf"
    pdf_path = os.path.join(reports_dir, pdf_filename)

    browser = await _get_report_browser()
    page = await browser.new_page()
    try:
        await page.set_content(html_content, wait_until="networkidle")
        # @page { size: A4 portrait; margin: 0 } trong html report -> giu nguyen bang CSS.
        await page.pdf(path=pdf_path, print_background=True, prefer_css_page_size=True)
    except Exception as e:
        raise RuntimeError(f"Lỗi khi Chromium tạo PDF: {e}")
    finally:
        await page.close()

    if not os.path.isfile(pdf_path) or os.path.getsize(pdf_path) == 0:
        raise RuntimeError("Chromium không tạo được file PDF hoặc file tạo ra rỗng.")
    return pdf_path
