# QA — Màn 3: AI Intelligence Studio

Ngày: 2026-10-10 · Chuẩn so sánh: `mockups_full/03_ai_intelligence_studio.png` (1586×992, 1x)

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Ảnh thực tế / đặt cạnh nhau | `ai_en.png` · `ai_side_by_side.png` |
| Chồng lớp pixel | `ai_overlay_anaglyph.png` |
| Đo bbox mực in 55 phần tử (`ai_inkbox_report.txt`) | Vị trí lệch ≤2px: 40/55 · ≤3px: 49/55 · ≤5px: 54/55 · kích thước lệch ≤5px: 45/55 |
| Lệch còn lại | Chữ trong màn này rộng hơn mockup 4–8px ở vài dòng dài (mockup dùng font hẹp hơn một chút ở màn này); nút "New Chat" lệch 7px |
| Tiếng Việt | `ai_vi.png` (rút gọn vài nhãn VI để vừa bố cục) |
| Thích ứng | `ai_en_1280x800.png`, `ai_en_1440x900.png`, `ai_en_1920x1080.png` |
| Tương tác (`node tools/smoke-ai.mjs`) | **14/14 PASS** (chạy 2 lần), không lỗi console |
| Hồi quy | Dashboard 14/14, CAD 2D 19/19 |

**Không tuyên bố giống 100%.**

## Trung thực về AI

- Hội thoại, kế hoạch 5 bước và 3 phương án trong mockup là **phiên mẫu** (`ai/sampleSession.ts`,
  `data-source="demo"`), ghi rõ trong menu "…" của khung chat. Không được tạo trên máy này.
- Tin nhắn mới **không** nhận câu trả lời bịa: hệ thống trả lời rằng Local AI runtime (llama.cpp / MLX)
  chưa được tích hợp và bản vẽ không bị thay đổi.
- Số liệu Local AI (model, VRAM, tốc độ) là `demo` từ `services/localAi.ts`.
- **Geometry Doctor chạy thật** — kiểm tra cục bộ, xác định trên bản vẽ đang mở (không dùng AI), báo
  3 kích thước sai lệch của Villa Riverside.
- **Approve & Apply** luôn hỏi xác nhận, nói rõ đề xuất mẫu không chứa lệnh CAD thực thi được, rồi mở
  "Office Layout - Option 1.dwg" trong CAD 2D như bản vẽ tham chiếu (raster + chú thích vector). Bản vẽ
  hiện có không bị sửa. **Undo** đóng lại bản vẽ đã áp dụng. **Reject** đánh dấu phương án và khoá
  duyệt. **Preview Changes** mở danh sách thao tác có cấu trúc (ERASE/WALL/DOOR/INSERT/ROOMTAG/DIM)
  — dạng mà runtime thật phải sinh ra để đi qua Command Bus.
- Scan to CAD, Voice CAD báo rõ cần runtime/mô hình trên máy.

## Khác biệt đã biết

1. Mặt bằng phương án 1 là ảnh raster (`ai_preview_office_floorplan.png`); asset bị cắt thiếu mép phải
   và dưới → mũi tên Bắc, kích thước 4200 bên phải và chuỗi kích thước 18600 bên dưới được vẽ lại bằng
   vector. Xem trước có kéo/thu phóng thật (dùng cùng bộ vẽ với CAD 2D).
2. Ảnh nội thất trong "Proposal Details" cắt từ `ai_proposal_details_panel.png` (asset chỉ là ảnh tham
   chiếu cả panel) — phần chữ của panel được code.
3. Phương án 2 và 3 không có ảnh trong gói asset → hiển thị trạng thái "chưa có bản xem trước" thay vì
   tự vẽ mặt bằng giả. Thông số của chúng là dữ liệu mẫu đặt ra cho phiên mẫu.
4. Nội dung do AI trả lời ("Hoàn thành · 24 giây", "Đề xuất phương án:") theo **ngôn ngữ của cuộc trò
   chuyện** (tiếng Việt), đúng như mockup ở giao diện EN; khung giao diện theo VI/EN.
5. Icon của 6 thẻ năng lực và 3 phương án dùng icon Lucide gần nghĩa nhất.

---

## Kiểm tra lại theo Pixel-Lock v2 — 2026-10-11

Mockup `TH_AI_CAD_Studio_UI_LOCK_v2/mockups/03_AI_Intelligence.png` giống từng pixel với bản đã QA trước đây.

Ảnh nằm trong `qa/v2/03_ai/`:
- `side_by_side.png`, `mockup.png`;
- `overlay_50_50.png`, `overlay_anaglyph.png`, `difference_amplified.png` (MAE 11.59);
- `app_en.png`, `app_vi.png`;
- `app_en_1280x800.png`, `app_en_1440x900.png`, `app_en_1920x1080.png`.

| | Chụp lại (trước khi sửa) | Sau khi sửa |
|---|---|---|
| Phần tử ≤ 2 px (55) | 40 | **46** |
| ≤ 3 px | 49 | **52** |
| ≤ 5 px | 54 | **55** |

**Đã sửa bố cục:**
- Nút New Chat và "…": chữ 13.5 px, cụm nút dời lên 3 px, khoảng cách giữa hai nút 8 px.
- Thẻ đề xuất: cao 44 px, dời lên 7 px; nút Preview nhỏ hơn và cách mép phải 3 px.
- Ô nhập: cao 40 px.
- Dòng "Hoàn thành" và các nhãn trên thanh Local AI.
- Nút Preview Changes: tăng khoảng cách icon–chữ. Nút Reject: nền hồng nhạt như mockup.

**Đã sửa nội dung (đúng luật của brief: không hiện trạng thái runtime giả):**
- Bản xem trên trình duyệt không có AI runtime. Trước đây, thanh Local AI ở màn này và thẻ Local AI ở Dashboard vẫn hiện số liệu
  của mockup như số thật: "Online", "Ready", "AutoCAD Assistant (Local)", "6.2 / 16 GB", "0.8s".
- Giờ hai chỗ này ghi:
  - trạng thái: **Demo UI**;
  - mô tả: "Browser preview — the AI runs in the desktop app";
  - Model: **Not connected**;
  - VRAM: con số kèm nhãn **DEMO**;
  - Response Speed: "—".
- App desktop (có host) vẫn hiện số đo thật từ llama.cpp như trước.

**9 phần tử còn lệch 3–5 px:**
- `cap1.tile`: viền ô icon; mockup vẽ ô cao hơn.
- `user.l3`, `user.time`: chữ trong bong bóng chat dài hơn mockup.
- `local.trait1`: nhãn "Private" có icon khác mockup.
- `sidebyside`, `det.totalv`, `det.imp5`: lệch 3 px.
- `btn.reject`: chữ trong mockup thấp hơn 3 px so với các nút cùng hàng (lỗi khi AI vẽ mockup).
- `chip1`: chip gợi ý; lệch 4 px.

**Tương tác:** smoke test AI 14/14, Dashboard 14/14, Settings 16/16 — đều đạt.
