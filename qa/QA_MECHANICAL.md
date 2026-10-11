# QA — Màn 11: Mechanical (Pixel-Lock v2)

- **Ngày:** 2026-10-12.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/11_Mechanical.png` (1586 × 992).

## Ảnh

Mọi ảnh nằm trong `qa/v2/11_mechanical/`.

| | Tệp |
|---|---|
| Mockup và app đặt cạnh nhau | `side_by_side.png`, `mockup.png` |
| Overlay, anaglyph, difference | `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png` (MAE 14.10) |
| EN / VI | `app_en.png`, `app_vi.png` |
| Kích thước khác | `app_en_1440x900.png`, `app_en_1920x1080.png` |

Ở 1440 px, thẻ "AI Design Checks" hẹp lại nên chỉ còn icon trạng thái; rê chuột vào từng dòng để xem chi tiết.

## Đo bbox 73 phần tử (`ui/tools/regions_mechanical.json` → `inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 7 |
| 1 px | 17 |
| 2 px | 23 |
| 3–5 px | 22 |
| 6–8 px | 4 |

**47/73 phần tử ≤ 2 px; 69/73 ≤ 5 px.**

4 phần tử lệch 6–8 px đều nằm trong panel phải: nhóm "Mass Properties" và dòng tên. Mockup vẽ dòng "Description" hai dòng cao hơn, nên các nhóm bên dưới bị dời xuống.

## Nội dung mockup đã sửa cho đúng (giữ bố cục)

| Mockup | App |
|---|---|
| Mass 12.480 kg | **12.640 kg** = thể tích 0.00158 m³ × khối lượng riêng inox 316 (8000 kg/m³). Đổi vật liệu thì khối lượng tính lại |
| "Strength Check (FEA) — 2 warnings" | App chưa có bộ giải FEA. Mục này ghi rõ "FEA solver not connected" và thay bằng **tính tay**: ứng suất xoắn trục τ = 16T/(πd³) = **2.9 MPa** (cho phép 30 MPa, thép AISI 1045 có hệ số rãnh then 0.75); ứng suất vòng thân bơm ở PN16 = 16.3 MPa (cho phép 138). Kết quả: **Hand check OK** — không bịa ra 2 cảnh báo |
| "Meets ISO 5199" | "Meets ISO 5199 nozzle layout" — chỉ kiểm tra cỡ cửa thuộc dãy DN (EN 1092-1) và cửa đẩy ≤ cửa hút, không phải toàn bộ ISO 5199 |
| "Parameters (8)" nhưng chỉ có 6 dòng | Thêm 2 tham số thật dùng trong tính toán: Motor_Power 11 kW, Speed 2900 rpm |
| "Fasteners (36)" | Tổng số lượng bu lông, vòng đệm, đai ốc trong BOM = 36 |
| Nhãn "AI" ở "Design Checks (AI)" | Giữ tên tab theo mockup; trong thẻ ghi rõ đây là kiểm tra theo quy tắc, AI cục bộ chưa kết nối |

## Chức năng thật

- **8 tham số sửa được**, có giới hạn hợp lệ, hoàn tác bằng ⌘Z. Năm kiểm tra tính lại ngay:
  - **va chạm:** khe hở hướng kính bánh công tác – lỗ thân (236 mm); trục – lỗ ổ 6208 (40 mm);
  - **khe hở:** khe hở hướng kính ≥ 2 mm;
  - **bền:** xoắn trục, ứng suất vòng thân bơm;
  - **tiêu chuẩn:** dãy DN của cửa hút/đẩy;
  - **chế tạo:** thành thân ≥ 6 mm (đúc khuôn cát).
- **Add Parameter:** thêm tham số người dùng.
- **BOM 24 dòng:** "View all" hiện đủ; bấm một dòng thì chọn cụm tương ứng trong panel Thuộc tính.
- **Panel Thuộc tính:** đổi vật liệu thì khối lượng tính lại; độ mờ (0–100 %) được lưu lại.
- **Configurations:** kích hoạt cấu hình khác thì đổi Motor_Power và chạy lại kiểm tra.
- **Display:** chế độ hiển thị.
- **Tab Mates / Constraints:** 8 ràng buộc lắp.
- **Header:** tab Drawing sang CAD 2D. Tab tài liệu có dấu "*" khi có thay đổi chưa lưu.
- **Xuất CSV:** BOM, tham số, báo cáo kiểm tra.

## Ghi rõ là chưa có

- **Khung nhìn 3D:** ảnh DEMO cắt từ mockup, các phần giao diện in sẵn trên ảnh đã được inpaint, có nhãn "DEMO render · mechanical 3D kernel not connected".
- Các công cụ dựng hình (Part, Sketch, Extrude, Revolve, Hole, Fillet, Chamfer, Pattern, Explode, Dimension, CAM Prep): báo "cần kernel 3D cơ khí". Engine cơ khí 3D là mô-đun riêng theo brief.
- Thể tích, diện tích, trọng tâm: số hình học mẫu, có ghi chú rõ.

## Tương tác đã kiểm tra (`ui/tools/smoke-mechanical.mjs` — 12/12 đạt)

- Màn mở giống mockup.
- Khối lượng 12.640 kg; đổi sang Duplex 2205 thì thành 12.324 kg; ⌘Z hoàn tác.
- Cả 5 kiểm tra đạt với tham số mẫu.
- Impeller_Dia 240: báo va chạm và khe hở nhỏ.
- Trục 20 mm với động cơ 30 kW: cảnh báo xoắn. Giá trị 5 bị chặn.
- Thành thân 4 mm: cảnh báo chế tạo.
- Run Check báo số lượng; Add Parameter; ⌘Z.
- BOM: "View all", bấm dòng Shaft thì chọn Shaft.asm.
- Configurations 15 kW.
- Tab Mates; tab Drawing sang CAD 2D.
- Xuất CSV BOM.
- Bản VI dịch đủ.
- Không có lỗi console.
