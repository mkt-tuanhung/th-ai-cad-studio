# QA — AI cho các bộ môn (mục 4)

Trợ lý AI cục bộ (llama.cpp, Qwen2.5-7B Q4_K_M, chạy trên máy, không cloud) cho **BIM, Nội thất, MEP, Hạ tầng, Cơ khí** — cùng nguyên tắc đã khoá với CAD 2D: AI **không tự sửa mô hình**, chỉ trả về một đề xuất gồm các thao tác có kiểu; thao tác được áp lên **bản sao** bằng code xác định, luật của bộ môn kiểm tra kết quả, người dùng thấy từng thay đổi rồi mới **Duyệt & áp dụng** (một bước ⌘Z) hoặc **Từ chối**.

## Cách hoạt động

- `ui/src/ai/discipline.ts`: khung chung — mô tả thao tác (enum lấy từ mô hình đang mở: mã ống, mã tường, vật liệu, phòng…; số có khoảng và đơn vị), grammar GBNF sinh tự động, system prompt + ví dụ, đọc JSON, kiểm tra từng thao tác, áp lên bản sao, kiểm tra luật. Giải mã "hybrid": lượt tự do trước, nếu không áp được thì chạy lại có grammar.
- `ui/src/ai/disciplines/*.ts`: thao tác của từng bộ môn. Những việc cần tính toán do **code** làm, không để model tự tính: hạ ống gió đến cao độ không va chạm, tăng cáp đến khi sụt áp ≤ 3 %, kẻ lại độ dốc đoạn kênh (tự dời cao độ hạ lưu), cập nhật bảng cắt khi đổi kích thước tủ.
- Native: `HostBridge::aiTask` (sinh văn bản trên luồng riêng, tín hiệu `aiTaskResult`); runtime llama.cpp giữ một context và **tái sử dụng KV cache** của phần prompt trùng (system + dữ liệu mô hình) — CAD 2D cũng được hưởng.
- Giao diện: MEP (tab Trợ lý AI), BIM (tab AI Assistant), Nội thất (ô yêu cầu sẵn có của mockup → đề xuất), Hạ tầng ("Hỏi AI cục bộ…" trong thẻ AI), Cơ khí (nút AI Assistant ở header). Trong trình duyệt hiển thị rõ "AI cục bộ chạy trong app desktop".
- BIM: AI không được **thêm** lỗi mô hình (tường đỉnh ≤ chân, cửa vượt tường, chồng cửa); lỗi có sẵn trong mô hình mẫu không chặn đề xuất.

## Đánh giá với model thật (`ui/tools/ai-discipline-eval.js`, chạy trong app)

Mỗi yêu cầu được chấm **bằng máy trên mô hình kết quả** (không chấm câu chữ). Không yêu cầu nào trùng ví dụ trong prompt.

| Lần chạy | Bộ | MEP | Nội thất | Hạ tầng | Cơ khí | BIM | Tổng |
|---|---|---|---|---|---|---|---|
| 1 (trước sửa) | A | 7/8 | 7/8 | 8/8 | 8/8 | 0/8 | 30/40 |
| 2 (sau 4 sửa) | A *(đã dùng để sửa)* | 8/8 | 8/8 | 8/8 | 8/8 | 7/8 | 39/40 |
| 2 | B *(viết trước khi sửa)* | 4/5 | 5/5 | 4/5 | 5/5 | 3/5 | **21/25** |
| 3 (thêm quy tắc từ chối) | A | 7/8 | 8/8 | 8/8 | 8/8 | 8/8 | 39/40 |
| 3 | B | 5/5 | 5/5 | 5/5 | 5/5 | 4/5 | 24/25 |
| 3 | C *(mới, đo sạch)* | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | **10/10** |

- Lần 1: BIM 0/8 là lỗi kiểm tra của tôi (mô hình mẫu có sẵn va chạm D12 → mọi đề xuất bị chặn), model trả đúng 7/8 thao tác. MEP "sửa sụt áp" chọn đổi CB thay vì cáp; Nội thất hiểu "gỗ óc chó" thành gỗ sồi.
- Sửa: chỉ chặn lỗi mới (BIM); thêm thao tác tính sẵn tăng cáp theo sụt áp (MEP); thêm tên vật liệu tiếng Việt vào ngữ cảnh (Nội thất).
- Điểm yếu lần 2: yêu cầu **không làm được** (thêm cầu thang, chiller, thang cá, tầng mới) — model bịa thao tác (0/4). Sửa: quy tắc từ chối + một ví dụ từ chối mỗi bộ môn → bộ C mới: 5/5 câu từ chối đúng.
- Còn sai: BIM "đỉnh tường W21 thấp hơn mái 200 mm" → model đổi **chân** tường; MEP "sửa sụt áp mọi mạch" (nhiều thao tác) lần 3 trả lời không hợp lệ. Cả hai đều hiện rõ trong bản xem trước, không có gì được áp nếu chưa duyệt.
- Log đầy đủ: `ai_discipline_eval_run1.txt`, `run2.txt`, `run3.txt`.

## Tốc độ (Mac này)

- Lần hỏi đầu trên một mô hình: ~24 s (đọc prompt ~4–7 nghìn token). Panel AI tự **làm nóng** khi mở → câu đầu tiên thực tế ~1,7 s (đo qua giao diện MEP).
- Các câu tiếp theo: trung vị 1,1–1,2 s; câu nhiều thao tác 2–10 s.

## Tự kiểm tra & smoke

- `THCAD_SELFTEST=1`: thêm "aiTask: grammar-constrained JSON from the local model" (máy không có model: kiểm tra từ chối).
- Luồng giao diện trong app desktop (MEP): gửi → đề xuất "SA-01 (L2): 600×400 → 700×400 mm · v 5 → 4.3 m/s" → Duyệt → mô hình đổi, thông báo "⌘Z để hoàn tác".
- Smoke trình duyệt bim / interior / mep / civil / mechanical: đạt.

## Giới hạn

- AI chỉ sửa thuộc tính của phần tử có sẵn (và thêm/xoá đồ nội thất); chưa tạo tường, ống, thiết bị mới.
- Renders chưa có trợ lý AI; AI Studio vẫn là phiên mẫu (có nhãn).
- Model 7B: yêu cầu mơ hồ (đỉnh/chân, "mọi mạch") có thể sai — luôn xem kỹ danh sách thay đổi trước khi duyệt.
