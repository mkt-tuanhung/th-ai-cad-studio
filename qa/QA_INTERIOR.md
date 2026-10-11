# QA — Màn 09: Interior (Pixel-Lock v2)

- **Ngày:** 2026-10-11.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/09_Interior.png` (1586 × 992). Đây là màn Design.

## Ảnh

Mọi ảnh nằm trong `qa/v2/09_interior/`.

| | Tệp |
|---|---|
| Mockup và app đặt cạnh nhau | `side_by_side.png`, `mockup.png` |
| Overlay, anaglyph, difference | `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png` (MAE 15.19) |
| EN / VI | `app_en.png`, `app_vi.png` |
| Kích thước khác | `app_en_1440x900.png`, `app_en_1920x1080.png` |

Ở 1440 px, nút Share và Export trên header thu lại chỉ còn icon. Các nút điều khiển trong khung nhìn bám theo mép phải và mép dưới.

## Đo bbox 65 phần tử (`ui/tools/regions_interior.json` → `inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 3 |
| 1 px | 23 |
| 2 px | 25 |
| 3–5 px | 13 |
| 6 px | 1 |

**51/65 phần tử ≤ 2 px; 64/65 ≤ 5 px.** Phần tử lệch 6 px là `ri.floorfin`: giá trị căn phải, và chuỗi chữ trong app khác chuỗi trong mockup.

## Bộ khung dùng chung (mới)

`ui/src/components/workspace/` gồm header, ribbon, cây duyệt, khung nhìn, bảng có tab và panel thuộc tính.

- Lấy giá trị từ màn BIM đã duyệt.
- Dùng cho Interior, MEP, Civil, Mechanical và Renders.
- Kèm `state/undoable.ts`: mọi chỉnh sửa đều được kiểm tra trước khi ghi, và hoàn tác / làm lại được bằng ⌘Z / ⌘⇧Z.

## Chức năng thật

- **Dữ liệu:** phòng có đường bao (mm), từ đó tính diện tích và chu vi. Ví dụ Living Room: 28.6 m² và 22.8 m, đúng số trong mockup.
- **Bảng Furniture & Items:**
  - chọn một dòng thì panel Thuộc tính hiện mục đó;
  - menu "…" có: đổi trạng thái, nhân bản, xoá, tìm trong Thư viện cấu kiện;
  - View all hiện toàn bộ danh sách.
- **Panel Thuộc tính:**
  - sửa được loại, phòng, số lượng, trạng thái, kích thước, vật liệu;
  - giá trị sai bị đánh dấu và không được áp dụng (ví dụ số lượng 0).
- **Tủ tham số và bảng cắt ván (Cut List — Production):**
  - mỗi tủ sinh ra: tấm hông, nóc/đáy, hậu 6 mm, vách chia (cứ 1200 mm một vách), đợt, cánh, kèm mét dán cạnh;
  - tổng số chi tiết, diện tích ván và số tấm 2440 × 1220 được ước với hiệu suất 80 %, và ghi rõ "Ước tính — xếp tấm / CAM chưa kết nối";
  - đổi kích thước tủ thì bảng cắt và đồ nội thất tương ứng cập nhật theo;
  - nút "Cabinet Parametric" mở hộp thoại thêm tủ; kích thước không hợp lệ thì nút Add bị khoá.
- **Room Quantities:** diện tích sàn, chu vi, chiều cao, diện tích tường thô (ghi rõ chưa trừ cửa), diện tích trần, vật liệu sàn.
- **Bảng Materials:** mỗi vật liệu được dùng ở đâu, và khối lượng tính bằng m² hoặc số cái.
- **Tab Vật liệu ở panel phải:** gán vật liệu cho đối tượng đang chọn.
- **Room Information** và **Room Context:** chọn phòng thì số liệu đổi theo.
- **Mẫu phong cách** (thẻ "AI Suggestions"): nút Apply áp một bảng vật liệu cố định cho phòng đang chọn. Đây là quy tắc có sẵn, không phải AI, và ⌘Z hoàn tác được. Ảnh gắn nhãn DEMO.
- **Xuất CSV:** bảng nội thất, bảng cắt ván, khối lượng phòng.
- **Điều hướng:**
  - header: Renders sang màn Kết xuất, Drawings sang CAD 2D, Schedule hiện bảng toàn khung;
  - ribbon: Furniture, Cabinet và Lighting lọc bảng; Material mở tab Vật liệu; Decor mở Thư viện cấu kiện; Cut List mở tab bảng cắt;
  - menu More Tools: Undo, Redo, khôi phục dữ liệu mẫu.

## Ghi rõ là chưa có (không giả lập)

- **Khung nhìn 3D:** dùng ảnh DEMO cắt từ mockup. Các phần giao diện in sẵn trên ảnh đã được inpaint. Ảnh có nhãn "DEMO render · interior engine not connected". Các chế độ hiển thị chỉ là bộ lọc ảnh.
- Xoay, kéo, thu phóng, Dimension, Tag, Nesting, Toolpath/G-code, mặt đứng, mặt cắt: báo "cần engine nội thất (chưa kết nối)".
- **Interior AI Designer:** yêu cầu gửi đi được lưu lại. App trả lời thẳng là "Demo UI / Not connected", vì model cục bộ hiện chỉ sửa bản vẽ CAD.

## Tương tác đã kiểm tra (`ui/tools/smoke-interior.mjs` — 12/12 đạt)

- Màn mở giống mockup.
- Room Information tính đúng và đổi theo phòng chọn.
- Sửa số lượng: chặn giá trị 0, áp dụng giá trị hợp lệ, ⌘Z hoàn tác.
- Mẫu Japandi: chỉ đổi đồ trong Living Room, ⌘Z hoàn tác.
- Bảng cắt: tấm nóc 3164 × 400; đổi rộng thành 2400 thì thành 2364 × 400, và đồ nội thất đổi theo.
- Hộp thoại tủ tham số: khoá khi rộng 100 mm, thêm được khi rộng 1200 mm.
- Room Quantities: 28.61 / 22.80 / 68.40.
- Gán vật liệu từ tab Vật liệu.
- View all và chế độ Wireframe.
- Xuất CSV bảng cắt.
- Ribbon và header điều hướng đúng.
- Bản VI dịch đủ: tab, phòng, nội dung prompt mặc định.
- Không có lỗi console.

## Asset

12 ảnh crop DEMO trong `ui/public/assets/v2/interior/`, liệt kê ở `MANIFEST.md` và `MISSING_PRODUCTION_ASSETS.md`, mục 09-xx.
