# QA — Màn 12: Renders (Pixel-Lock v2)

- **Ngày:** 2026-10-12.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/12_Renders.png` (1586 × 992).

## Ảnh

Mọi ảnh nằm trong `qa/v2/12_renders/`.

| | Tệp |
|---|---|
| Mockup và app đặt cạnh nhau | `side_by_side.png`, `mockup.png` |
| Overlay, anaglyph, difference | `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png` (MAE 22.29) |
| EN / VI | `app_en.png`, `app_vi.png` |
| Kích thước khác | `app_en_1440x900.png`, `app_en_1920x1080.png` |

MAE của màn này cao hơn các màn khác chủ yếu do hàng đợi: mockup vẽ thanh tiến độ màu xanh, app không có.

## Đo bbox 59 phần tử (`ui/tools/regions_renders.json` → `inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 7 |
| 1 px | 7 |
| 2 px | 13 |
| 3–5 px | 26 |
| > 5 px | 6 |

**27/59 phần tử ≤ 2 px; 53/59 ≤ 5 px.**

6 phần tử lệch > 5 px:
- Nhãn vật liệu và ô tìm kiếm trong Asset Library: vùng đo lẫn cả quả cầu vật liệu và chữ gợi ý.
- Ba phần tử ở panel phải: tiêu đề nhóm và các ô giá trị dời xuống vì có thêm dòng ước tính dung lượng.

## Nội dung mockup đã sửa cho đúng (giữ bố cục) — luật của brief

Brief: *"Nếu renderer chưa có, preview chỉ là demo; không hiển thị render hoàn tất giả."*

| Mockup | App |
|---|---|
| Hàng đợi: "Cam 01 — Rendering 68%" | Cả 3 việc trong hàng đợi đều ở trạng thái **"Waiting — renderer not connected" (0 %)**. Không có tiến độ giả |
| "Render History (12)" | **Render History (0)**: bản này chưa kết xuất ảnh nào |
| Ảnh xem trước như kết quả render | Ảnh DEMO có nhãn "DEMO preview · renderer not connected". Các camera và biến thể khác Cam 01 dùng ảnh thu nhỏ (độ phân giải thấp) |
| Các nút bật/tắt AI Enhancement | Lưu vào thiết lập của tác vụ, có ghi chú "chạy khi bộ kết xuất AI cục bộ được kết nối" |

## Chức năng thật

- **Camera:** chọn camera (danh sách hoặc ô chọn), thêm camera từ góc nhìn hiện tại, nhân bản, xoá, đưa vào hàng đợi (menu •••).
- **Thiết lập kết xuất** (đều kiểm tra hợp lệ, hoàn tác bằng ⌘Z):
  - độ phân giải; tỉ lệ khung tự suy ra; định dạng; DPI;
  - bộ kết xuất, số mẫu (thanh trượt và ô số, ví dụ 10 bị từ chối), khử nhiễu, số lần phản xạ, chất lượng;
  - HDRI, góc xoay, mặt trời, cường độ nắng, hướng nắng;
  - 4 tuỳ chọn AI.
- **Ước tính bằng phép tính:** dung lượng tệp = W × H × số byte mỗi điểm ảnh × tỉ lệ nén. Ví dụ 4K PNG ≈ 13.1 MB, 8K ≈ 52.2 MB. Số megapixel. Kích thước in = điểm ảnh / DPI × 2.54 (32.5 × 18.3 cm ở 300 DPI).
- **Biến thể** (Original / Warm Lighting / Overcast / Night Scene): áp bộ thông số ánh sáng tương ứng vào thiết lập, hoàn tác được, và đổi ảnh xem trước.
- **Hậu kỳ:** phơi sáng, tương phản, bão hoà, nhiệt độ màu, tối góc. Áp trực tiếp lên ảnh xem trước bằng bộ lọc và lưu cùng thiết lập.
- **Hàng đợi:** "Render Current View", nút Render ở header, tab "Batch Render" (đưa mọi camera vào hàng đợi), xoá từng việc.
- **Save View:** lưu thành camera mới, xuất thiết lập ra JSON, lưu ảnh xem trước.
- **Asset Library:** tìm vật liệu. Các tab Models / Plants / People dẫn sang Thư viện cấu kiện.
- **Chế độ hiển thị:** Wireframe, Clay, Shaded, Rendered.

## Tương tác đã kiểm tra (`ui/tools/smoke-renders.mjs` — 11/11 đạt)

- Màn mở giống mockup.
- Không có tiến độ giả: 3 việc đang chờ ở 0 %, Lịch sử (0).
- "Render Current View" thêm một việc 4K · 1024 samples · PNG.
- Ước tính 13.1 MB / 8.3 MP / 32.5 × 18.3 cm; chọn 8K thì thành 52.2 MB; ⌘Z hoàn tác.
- Số mẫu: chặn 10, nhận 2048, và hàng đợi hiện đúng 2048.
- Chọn camera; thêm camera.
- Biến thể Night Scene; ⌘Z hoàn tác.
- Phơi sáng +1 EV thì ảnh xem trước dùng bộ lọc brightness(2).
- "Batch Render"; xoá một việc.
- Xuất thiết lập JSON.
- Bản VI dịch đủ.
- Không có lỗi console.

## Asset

19 ảnh crop DEMO trong `ui/public/assets/v2/renders/`:
- ảnh xem trước (các phần giao diện in sẵn đã được inpaint);
- 5 ảnh camera;
- 8 quả cầu vật liệu;
- 4 ảnh biến thể;
- ảnh HDRI.
