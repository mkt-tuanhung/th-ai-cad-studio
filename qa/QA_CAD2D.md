# QA — Màn 2: CAD 2D Workspace

Ngày: 2026-10-10 · Chuẩn so sánh: `mockups_full/02_cad2d_workspace.png` (1586×992, 1x)
Cách chụp: Playwright Chromium headless, 1586×992 @1x, profile mới (tài liệu Villa Riverside, EN).

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Ảnh thực tế / đặt cạnh nhau | `cad2d_en.png` · `cad2d_side_by_side.png` |
| Chồng lớp pixel | `cad2d_overlay_anaglyph.png` — vùng bản vẽ trùng gần như tuyệt đối (ảnh nền đặt đúng toạ độ cắt từ mockup; ký hiệu vector bên phải/dưới nối liền) |
| Đo bbox mực in 53 phần tử (`cad2d_inkbox_report.txt`) | Vị trí lệch ≤2px: 39/53 · ≤3px: 47/53 · kích thước lệch ≤3px: 47/53 |
| 6 phần tử lệch 4–5px | nhãn Viewport/Layout của ribbon, giá trị Layer, hộp tỉ lệ 1:100, chữ "3200" (vector); `status.model` là lỗi vùng đo (chữ trắng trên nền đậm) |
| Tiếng Việt | `cad2d_vi.png` |
| Thích ứng | `cad2d_en_1280x800.png` (tự zoom vừa khung, ribbon cuộn ngang, palette co hàng), `cad2d_en_1440x900.png`, `cad2d_en_1920x1080.png` |
| Tương tác (`node tools/smoke-cad2d.mjs`) | **19/19 PASS**, không lỗi console |
| Hồi quy Dashboard (`npm run test:smoke`) | 14/14 PASS |

**Không tuyên bố giống 100%.**

## Những gì chạy thật (trên mô hình prototype TypeScript)

- Command Bus: `validate → preview → commit → undo/redo` (lớp khóa, hình học suy biến bị từ chối).
- Lệnh: LINE, PLINE (Close/Undo), RECTANG, CIRCLE (bán kính gõ số), ARC 3 điểm, DIMLINEAR, TEXT,
  MOVE, OFFSET (đường thẳng/đường tròn), ERASE, UNDO/REDO, ZOOM E, LAYER, PROPERTIES, QSAVE, NEW,
  OPEN (DXF), DXFOUT. Nhập toạ độ `x,y`, `@dx,dy`, `@d<góc`. Gõ phím ở bất kỳ đâu → vào dòng lệnh;
  Enter/Space/chuột phải = Enter; Esc huỷ; mũi tên lên = gọi lại lệnh.
- Bắt điểm: OSNAP (endpoint/midpoint/center), SNAP lưới 50 mm, ORTHO, POLAR 45°; F3/F7/F8/F9/F10.
- Chọn: click, Shift thêm/bớt, cửa sổ trái→phải (window) / phải→trái (crossing); grip hiển thị.
- Properties sửa thật Layer/Color/Linetype/Lineweight/Transparency của đối tượng chọn; View hiển thị
  tâm/kích thước khung nhìn thực tế. Layers bật/tắt, khoá, đặt lớp hiện hành.
- "Detected (3)": kiểm tra cục bộ, phát hiện 3 kích thước có chữ ghi khác số đo hình học
  (3200/6600/9800 trên bản vẽ mẫu không đúng tỉ lệ) — không dùng AI, không bịa.
- Xuất DXF R12 (tải tệp) và nhập DXF R12–2018 kể cả block/kích thước/hatch/spline (2026-10-11, xem
  `QA_DWG_RENDER_PACKAGING.md`; bản vẽ thật 41 717 đối tượng nhập trong 0,3 s).
- Tab tài liệu (mới/đóng/chuyển), dấu "chưa lưu", Save/Save As, Layout1/2 xem trước khổ A3.

## Những gì cố ý KHÔNG giả lập (báo rõ trong dòng lệnh / toast)

- TRIM, HATCH, PLOT, tạo layout mới, xuất PDF/PNG → "cần CAD engine native".
- Mở DWG → cần thư viện đọc DWG (chờ chủ đầu tư chọn: LibreDWG/GPL, ODA File Converter, ODA SDK trả phí); hiện mở DXF.
- AI Assist (Suggestions/Generate/Modify) → "Local AI runtime chưa kết nối"; khi có, mọi đề xuất phải
  qua xem trước + phê duyệt.

## Khác biệt đã biết

1. **Mặt bằng chi tiết là ảnh raster** (`cad2d_main_floorplan_canvas.png`) gắn như IMAGE underlay
   (tab References ghi rõ). Asset bị cắt thiếu mép phải/dưới và lẹm thanh tab ở trên → phần lưới trục,
   kích thước tổng, mũi tên Bắc ở mép được vẽ lại bằng vector thật. Phóng to sẽ thấy ảnh mờ.
2. **View Height/Width** hiển thị số tính thật từ khung nhìn (12615 × 17957 mm), mockup ghi
   12000 × 18000 — hai số của mockup không cùng tỉ lệ khung hình nên không thể vừa đúng vừa trung thực.
3. Mockup ghi "Detectada (3)" — chủ đầu tư đã xác nhận (2026-10-10) chữ đúng là **"Detected (3)"**;
   bản VI là "Phát hiện (3)".
4. Mockup có bộ nút trạng thái không đồng nhất (ORTHO/OSNAP dạng viên thuốc, GRID/SNAP/POLAR/MODEL có
   núm tròn, núm nằm bên trái cả khi bật) — dựng đúng như mockup.
5. Biểu tượng AI Assist từng mục dùng icon Lucide gần nghĩa (mockup là hình minh hoạ nhỏ).
6. Icon nút thứ ba nhóm Viewport/Layout không có nhãn trong mockup — gán chức năng "Sheet Set" (chưa có
   ở prototype).
