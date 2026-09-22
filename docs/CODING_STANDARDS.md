# QUY CHUẨN LẬP TRÌNH & NGUYÊN TẮC PHÁT TRIỂN (CODING STANDARDS)
## Dự án: Vali Hiện Trường (Vali Căn Phạm)

---

## 1. Nguyên tắc Tổng quát (General Principles)

1. **KISS (Keep It Simple, Stupid)**: Ưu tiên mã nguồn rõ ràng, dễ đọc, cấu trúc tường minh hơn là viết code quá phức tạp.
2. **DRY (Don't Repeat Yourself)**: Không sao chép các đoạn mã xử lý dữ liệu, biểu mẫu, tính toán dấu vết giống nhau. Đóng gói vào hàm tiện ích (`utils`) hoặc custom hooks.
3. **Single Responsibility (SRP)**: Mỗi hàm, mỗi file, mỗi component chỉ nên chịu trách nhiệm cho một công việc duy nhất.
4. **Không để lại Code rác / Dead Code**: Khi gỡ bỏ tính năng (như đã gỡ bỏ YOLO, cân điện tử, CCCD quét chip cũ), phải gỡ bỏ triệt để cả UI, biến state, callback, API endpoint và schema liên quan.
5. **An toàn & Chống sập ứng dụng (Fail-Safe)**: Bắt buộc bọc `try/catch` các thao tác I/O, gọi API ngoại vi và giao tiếp phần cứng. Tuyệt đối không để một lỗi ngoại vi làm crash toàn bộ giao diện (White Screen of Death).

---

## 2. Quy chuẩn Python (Backend FastAPI)

### 2.1 Phong cách viết mã (Style Guide)
- Tuân thủ nghiêm ngặt **PEP 8**.
- Tự động kiểm tra với **Ruff** hoặc **Flake8 / Black**.
- **Thụt lề**: 4 khoảng trắng (spaces), không dùng Tab.
- Độ dài dòng khuyến nghị: tối đa **100 ký tự**.

### 2.2 Quy tắc đặt tên (Naming Conventions)
| Đối tượng | Quy tắc | Ví dụ |
| :--- | :--- | :--- |
| **Package / Module / File** | `snake_case` | `case_service.py`, `scene_traces.py` |
| **Class** | `PascalCase` | `CaseCreateSchema`, `FingerprintMatcher` |
| **Hàm / Method** | `snake_case` | `get_case_by_id()`, `extract_minutiae()` |
| **Biến / Tham số** | `snake_case` | `detainee_id`, `total_records` |
| **Hằng số** | `UPPER_SNAKE_CASE` | `MAX_FINGER_RETRY`, `JWT_ALGORITHM` |

### 2.3 Type Hinting & Validation (Pydantic v2)
- **Bắt buộc** khai báo Type Hints cho toàn bộ tham số và kiểu trả về của hàm:
  ```python
  async def get_detainee(detainee_id: str) -> Optional[DetaineeResponse]:
      ...
  ```
- Dùng Pydantic Schema để validate dữ liệu đầu vào / đầu ra:
  ```python
  from pydantic import BaseModel, Field
  from typing import Optional

  class DetaineeCreate(BaseModel):
      full_name: str = Field(..., min_length=2, max_length=100, description="Họ và tên")
      dob: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
      gender: str = Field("male", description="Giới tính")
  ```

### 2.4 Quản lý Lỗi & HTTP Status Codes (Exception Handling)
- Sử dụng đúng mã trạng thái HTTP:
  - `200 OK`: Truy vấn hoặc xử lý thành công.
  - `201 Created`: Tạo mới bản ghi thành công.
  - `400 Bad Request`: Dữ liệu gửi lên không hợp lệ hoặc vi phạm logic nghiệp vụ.
  - `401 Unauthorized`: Chưa đăng nhập hoặc Token hết hạn.
  - `403 Forbidden`: Không đủ quyền hạn thực hiện thao tác.
  - `404 Not Found`: Không tìm thấy tài nguyên.
  - `409 Conflict`: Trùng lặp dữ liệu (ví dụ mã vụ án đã tồn tại).
  - `500 Internal Server Error`: Lỗi máy chủ không mong muốn.
- Sử dụng `HTTPException` với thông báo song ngữ hoặc mã lỗi rõ ràng:
  ```python
  from fastapi import HTTPException, status

  if not case_item:
      raise HTTPException(
          status_code=status.HTTP_404_NOT_FOUND,
          detail="Hồ sơ vụ án không tồn tại hoặc đã bị xóa."
      )
  ```

---

## 3. Quy chuẩn JavaScript / React (Frontend)

### 3.1 Phong cách viết mã (Style Guide)
- Khuyến nghị sử dụng **React Functional Components** kết hợp **Hooks**.
- Không viết file component vượt quá **500 dòng**. Nếu vượt quá, phải tách nhỏ thành các sub-components hoặc custom hooks.
- Linter: **Oxlint** / **ESLint** (Đảm bảo chạy `npm run lint` đạt 0 error trước khi commit).
- **Thụt lề**: 2 khoảng trắng (spaces).

### 3.2 Quy tắc đặt tên (Naming Conventions)
| Đối tượng | Quy tắc | Ví dụ |
| :--- | :--- | :--- |
| **Component File** | `PascalCase.jsx` | `CaseCard.jsx`, `FingerprintModal.jsx` |
| **Hook File** | `camelCase.js` | `useFingerprint.js`, `useI18n.js` |
| **Util / Helper File** | `camelCase.js` | `imageUtils.js`, `dateFormatter.js` |
| **Component Name** | `PascalCase` | `function CaseList() { ... }` |
| **Biến / Hàm** | `camelCase` | `handleSaveProfile()`, `activeCaseId` |
| **Custom Hook** | `use + PascalCase` | `useCaseDetail()`, `useDeviceStatus()` |
| **Hằng số** | `UPPER_SNAKE_CASE` | `DEFAULT_PAGE_SIZE`, `FINGER_CODES` |
| **CSS Class** | `kebab-case` hoặc BEM | `.case-card`, `.cap-sheet--split` |

### 3.3 Quy tắc Quản lý State & Hooks
1. **Dependencies của `useEffect` / `useCallback` / `useMemo`**:
   - Phải khai báo đầy đủ mọi biến sử dụng bên trong hook vào mảng dependencies, hoặc dùng `useRef` cho các giá trị mutable không cần trigger re-render.
2. **Tránh Unmounted State Updates**:
   - Mọi async effect (gọi API, fetch camera, poll thiết bị) phải có cờ `cancelled` hoặc `AbortController` để cleanup khi unmount:
   ```javascript
   useEffect(() => {
     let cancelled = false;
     api.getCase(id)
       .then(data => { if (!cancelled) setCaseDoc(data); })
       .catch(err => { if (!cancelled) setError(err.message); });
     return () => { cancelled = true; };
   }, [id]);
   ```
3. **Tránh Dead State**:
   - Không khai báo state nếu không có JSX nào sử dụng hoặc không tham gia vào logic render.

### 3.4 Quy tắc Đa ngôn ngữ (i18n) & Tránh Hardcode Text
- Tuyệt đối không hardcode chuỗi text hiển thị cố định trong JSX.
- Sử dụng hook `useI18n`:
  ```jsx
  const { t } = useI18n();
  return <button>{t("common.save")}</button>;
  ```
- Khai báo đầy đủ key ở cả 2 từ điển: `src/locales/vi.json` và `src/locales/en.json`.

---

## 4. Quy chuẩn Giao diện & Trải nghiệm (UI/UX Standards)

1. **Thiết kế tối ưu cho Hiện trường & Màn hình cảm ứng**:
   - Kích thước vùng bấm tối thiểu cho nút bấm cảm ứng: **44px x 44px**.
   - Khoảng cách giữa các nút thao tác nhanh rõ ràng, tránh bấm nhầm.
2. **Hiển thị Trạng thái (Visual Feedback)**:
   - Mọi hành động gửi yêu cầu (Lưu, Xóa, Đối sánh, Quét vân tay) phải có trạng thái loading/disabled để tránh người dùng bấm nhiều lần (double submit).
   - Có thông báo `toast` rõ ràng khi thành công hoặc thất bại.
3. **Màu sắc & Theme**:
   - Đảm bảo tương phản cao cho chế độ Dark Mode / Light Mode.
   - Màu cảnh báo nghiệp vụ (`danger`/`warning`) chỉ dùng cho cảnh báo thật (trùng đối tượng, lỗi thiết bị), không dùng tràn lan gây nhiễu cho cán bộ.

---

## 5. Quy chuẩn Git & Commit Conventions

### 5.1 Quy tắc đặt tên Branch
- `feature/<ten-tinh-nang>`: Nhánh phát triển tính năng mới (vd: `feature/case-sync-usb`).
- `fix/<ten-loi>`: Nhánh sửa lỗi (vd: `fix/capture-page-crash`).
- `refactor/<ten-module>`: Nhánh tái cấu trúc code (vd: `refactor/modularize-dashboard`).

### 5.2 Quy tắc viết Commit Message (Conventional Commits)
Cấu trúc chuẩn: `<type>(<scope>): <mô tả ngắn gọn>`
- `feat`: Thêm tính năng mới.
- `fix`: Sửa lỗi.
- `refactor`: Tái cấu trúc mã nguồn không làm thay đổi hành vi.
- `docs`: Thêm hoặc chỉnh sửa tài liệu.
- `style`: Định dạng code, sửa khoảng trắng, linter (không đổi logic).
- `test`: Thêm hoặc sửa unit test.
- `chore`: Cập nhật cấu hình build, dependencies.

**Ví dụ:**
```text
feat(capture): thêm tính năng đánh dấu ngón tay bị thiếu
fix(ui): sửa lỗi trắng màn hình khi click thêm đối tượng
refactor(backend): tách routers từ main.py sang thư mục routers/
docs(arch): cập nhật tài liệu kiến trúc hệ thống và quy chuẩn code
```

---

## 6. Checklist Kiểm tra trước khi Pull Request / Release

- [ ] `npm run lint` ở frontend đạt 0 lỗi (0 errors).
- [ ] `npm run build` ở frontend biên dịch thành công mà không có lỗi build.
- [ ] Backend khởi động không bị lỗi thiếu module (`python -m uvicorn main:app`).
- [ ] Không còn `console.log` debug rác hoặc biến chưa định nghĩa (`no-undef`).
- [ ] Các chuỗi text mới đã được thêm vào cả `vi.json` và `en.json`.
- [ ] Tài liệu API hoặc ghi chú thay đổi đã được cập nhật nếu có thay đổi cấu trúc dữ liệu.
