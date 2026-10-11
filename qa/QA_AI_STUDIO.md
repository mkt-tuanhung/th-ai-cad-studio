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
