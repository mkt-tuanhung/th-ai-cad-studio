# QA — Màn 05: Projects & File Management (Pixel-Lock v2)

- **Ngày:** 2026-10-11.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/05_Projects.png` (1586 × 992).
- **Cách chụp:** `ui/tools/capture.mjs projects` (Chromium 1586 × 992 @1x, hồ sơ mới, dữ liệu mẫu, EN).

## Ảnh

| | Tệp |
|---|---|
| Mockup | `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/05_Projects.png` |
| Trước (màn chờ) | `qa/v2/before/projects.png` · overlay/diff `qa/v2/05_projects_before/` (MAE 26.04) |
| Sau (EN) | `qa/v2/projects_en.png` · overlay/diff `qa/v2/05_projects/` (MAE 12.65) |
| VI | `qa/v2/projects_vi.png` |
| Kích thước khác | `qa/v2/projects_en_1440x900.png` (lưới 3 cột, bảng co giãn), `qa/v2/projects_en_1920x1080.png` |

MAE đo cả ảnh minh hoạ và khử răng cưa chữ, nên chỉ để tham khảo. Thước đo chính là bbox mực in.

## Đo bbox 62 phần tử (`ui/tools/regions_projects.json` → `qa/v2/projects_inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 34 |
| 1 px | 18 |
| 2 px | 5 |
| 3 px | 2 |
| > 3 px | 3 |

- **3 phần tử lệch quá 3 px:**
  - Badge "24": vùng đo lẫn cả nền badge (lỗi đo).
  - "Modified 3 weeks ago" ở thẻ 8: lệch 4 px.
  - Ô AI Model: lệch 4 px vì có thêm chip DEMO, cố ý.
- **AppShell:** icon menu lệch ≤ 2 px, chữ ≤ 3 px, dòng đang chọn ≤ 4 px trên 9 mockup.
  Dashboard đo lại sau khi sửa shell: 49/51 phần tử ≤ 2 px, không lệch thêm.

## Khác biệt còn lại

1. **Ảnh minh hoạ là DEMO** cắt từ mockup (xem `MISSING_PRODUCTION_ASSETS.md`); nhãn và sao bị dính
   trong ảnh đã được xoá bằng inpainting. Thẻ Pump còn một vết mờ nhỏ ở mép trên.
2. **Sao yêu thích của Pump Assembly:** mockup 01 (Dashboard) để là yêu thích, mockup 05 thì không. App giữ
   trạng thái như mockup 01 (màn đã duyệt). **Cần chủ đầu tư chọn.**
3. **Tag "BIM" của Hospital Building:** mockup vẽ viền xanh nền trắng, app tô nền xanh nhạt giống các tag BIM khác.
4. **Ô AI Model:** mockup ghi "AutoCAD Assistant (Local)". Trong app desktop, ô này hiện tên model thật đang chạy
   (Qwen2.5-7B); trên trình duyệt hiện tên trong mockup kèm chip **DEMO**.
5. **Hai nút ⋮ trên mỗi thẻ** (ở tiêu đề và ở chân thẻ) giữ đúng mockup, cả hai mở cùng một menu.
6. **Thứ tự sắp xếp trong bảng tệp:** để khớp mockup (thư mục trước, rồi tệp mới nhất), các thư mục
   04–06 của dữ liệu mẫu được đặt làm thư mục con. Tab "Folders (6)" vẫn đếm đủ 6.

## Tương tác đã kiểm tra (`ui/tools/smoke-projects.mjs` — 18/18 đạt)

- Tab All / Recent / Shared / Archived lọc đúng; badge "24".
- Tìm kiếm, lọc bộ môn, lọc trạng thái, sắp xếp theo tên; chuyển lưới ↔ danh sách.
- Chọn thẻ thì inspector cập nhật; bấm ★ bật/tắt yêu thích.
- Menu ⋮ → Archive / Restore: badge đổi và có ghi vào Recent Activity.
- Inspector: đổi trạng thái, bật/tắt Auto Save, đổi hệ đơn vị, thêm tag bộ môn, sửa mô tả qua nút Edit.
  Mọi thay đổi đều được lưu.
- Storage Usage tính từ tổng dung lượng các tệp của dự án (6.2 / 20 GB).
- Project Files:
  - Số đếm theo từng tab; mở thư mục và quay lại.
  - Chọn tất cả; đổi tên, gỡ mục khỏi danh mục (không xoá tệp trên ổ đĩa).
  - New Folder.
  - Import Files: tệp DXF vừa nhập mở thẳng được trong CAD 2D qua "Open in CAD 2D".
- New Project và From Template (mẫu kênh tưới tạo sẵn 5 thư mục); View all mở toàn bộ hoạt động.
- Chuyển sang VI dịch toàn bộ màn; dữ liệu vẫn còn sau khi reload; Dashboard vẫn 12 dự án đang làm.
- Không có lỗi console.
- Các bộ test cũ không hồi quy: Dashboard 14/14, CAD 2D 21/21, AI 14/14, BIM 16/16.

**Không tuyên bố giống 100%.**
