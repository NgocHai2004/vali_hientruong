# Hệ thống Quản lý Hồ sơ Căn phạm & Hiện trường (Vali Căn Phạm)

## 1. Giới thiệu
Hệ thống phần mềm chuyên dụng phục vụ công tác thu thập, quản lý hồ sơ can phạm và khám nghiệm hiện trường lưu động. Ứng dụng tích hợp đa thiết bị ngoại vi gồm camera nhận diện khuôn mặt (AI), máy quét vân tay Morfin, đầu đọc thẻ CCCD gắn chip, cân điện tử và công cụ trích xuất so khớp dấu vết hiện trường.

---

## 2. Cấu trúc thư mục tổng quan

```text
┌── backend/        # FastAPI REST API + xử lý AI (InsightFace, YOLO)
│   └── services/   # Điều khiển thiết bị ngoại vi (vân tay Morfin, USB dongle, CCCD)
├── frontend/       # Giao diện web (React 19 + Vite, port 5173)
├── electron/       # Vỏ ứng dụng desktop (Electron)
└── *.ps1           # Các script tự động hóa (run, stop, start-services)
```

---

## 3. Cách chạy dự án

### Chuẩn bị
1. **Cấu hình môi trường**: Đảm bảo file `.env` ở thư mục gốc có đủ:
   ```env
   MONGO_URL=mongodb+srv://...
   DB_NAME=app_cccd
   JWT_SECRET=your-jwt-secret
   DONGLE_SECRET=your-dongle-secret
   ```
2. **Cài đặt thư viện**:
   - Backend:
     ```powershell
     .\.venv\Scripts\Activate.ps1
     pip install -r backend\requirements.txt
     ```
   - Frontend:
     ```powershell
     cd frontend
     npm install
     ```

### Khởi chạy

- **Cách 1 — Chạy toàn bộ hệ thống (Khuyên dùng):**
  ```powershell
  .\run.ps1
  ```
  *(Tự động bật các service phần cứng :8767, :8768, Backend :8000 và Frontend :5173)*

- **Cách 2 — Chạy riêng lẻ để dev:**
  - Backend:
    ```powershell
    .\.venv\Scripts\python.exe -m uvicorn --app-dir backend main:app --port 8001 --reload
    ```
  - Frontend:
    ```powershell
    cd frontend
    npm run dev
    ```

### Dừng hệ thống
```powershell
.\stop.ps1
```
