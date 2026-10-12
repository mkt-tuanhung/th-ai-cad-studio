# QA — Nút "Tải mô hình AI" (Cài đặt → Cấu hình mô hình AI)

Bộ cài (DMG 150 MB / EXE) không kèm mô hình AI. Người dùng tải mô hình ngay trong app:
- tải về đúng thư mục mà AI runtime đọc;
- kiểm tra file xong mới cài;
- nạp mô hình và hỏi thử, rồi mới báo "sẵn sàng".

## Cách làm (native/app/src/model_downloader.cpp)

**Danh mục** (dung lượng và sha256 lấy từ Hugging Face, ghi cứng trong code):

| Mô hình | Kích thước | Nguồn |
|---|---|---|
| Qwen2.5-7B Instruct Q4_K_M | 2 phần, 4.683.073.632 byte | `Qwen/Qwen2.5-7B-Instruct-GGUF` |
| Qwen2.5-3B Instruct Q4_K_M | 2.104.932.768 byte | `Qwen/Qwen2.5-3B-Instruct-GGUF` |

- Mô hình được **khuyên dùng** chọn theo RAM, cùng quy tắc mà runtime dùng để tự chọn mô hình (35 % RAM). Máy 16 GB trở lên được khuyên 7B; máy 8 GB được khuyên 3B.
- **Thư mục:** đúng `ai::modelsDir()`, gồm cả thư mục người dùng tự chọn trong Cài đặt. Trên Windows là `%LOCALAPPDATA%\MD CAD AI STUDIO\models`.
  - `modelsDir()` chỉ chuyển sang thư mục mới khi thư mục đó đã có dữ liệu. Vì vậy mô hình cũ trong "TH AI CAD Studio" không bao giờ bị che mất.
- **Trước byte đầu tiên:**
  - tạo thư mục và thử ghi một file;
  - kiểm tra dung lượng trống ≥ phần còn phải tải + 512 MB.
- **Trong khi tải:**
  - mỗi phần ghi vào `<tên>.gguf.part`, cùng thư mục với file cuối, nên lúc đổi tên là nguyên tử;
  - runtime không bao giờ đọc file `.part`.
- **Tải tiếp** bằng HTTP Range. Áp dụng khi mất mạng (tự thử lại 5 lần, chờ 2–30 giây), khi bấm Tạm dừng, hoặc khi tắt app giữa chừng.
  - Nếu máy chủ bỏ qua Range, phần đó được tải lại từ đầu.
  - Lỗi 416 thì xoá phần đó rồi tải lại.
  - Lỗi 4xx thì báo ngay, không thử lại vô ích.
  - Đứng yên 60 giây được tính là mất mạng.
- **Kiểm tra:** từng phần phải đúng kích thước và đúng sha256 (băm ở luồng nền, có hiện tiến độ). Sai thì xoá file và báo lỗi.
- **Cài đặt:** chỉ khi **mọi phần** đã đạt mới đổi tên. Phần 1 (file mà runtime liệt kê) được đổi tên **sau cùng**, nên app không bao giờ thấy một mô hình thiếu phần.
- **Sau khi cài:**
  - nạp mô hình vào runtime;
  - hỏi thử một câu ("Reply with the single word OK.");
  - chỉ khi có câu trả lời mới báo "Trợ lý AI đã sẵn sàng".
- **Giao diện** (`ui/src/services/modelDownload.ts`):
  - một kênh nhận tín hiệu chung cho toàn app;
  - trong lúc tải, cứ 3 giây hỏi lại trạng thái từ phần lõi, nên nếu lỡ mất một tín hiệu thì giao diện vẫn về đúng kết quả cuối;
  - khi chưa có mô hình, khối tải nằm ngay trong khung AI; khi AI đã sẵn sàng, khối tải nằm trong "Quản lý mô hình".

## Kiểm thử (app desktop thật, `native/app/resources/e2e_modeldl.js`)

Mọi lần chạy đều dùng một thư mục mô hình trống (`THCAD_MODELS_DIR`).

| Tình huống | Kết quả |
|---|---|
| **Tải thật từ Hugging Face**, 7B: khuyên dùng 7B (máy 32 GB) → tải → Tạm dừng ở ~15 % → Tải tiếp → sha256 → cài → nạp → hỏi thử | **16/16 PASS**. Khoảng 2 phút ở ~48 MB/s. Mô hình trả lời "OK" sau 0,6 s trên Apple M1 Max (Metal) |
| Tạm dừng | File `.part` được giữ lại; runtime không thấy mô hình nào; AI vẫn "chưa nạp"; nút đổi thành "Tải tiếp (còn 3.7 GB)" |
| Tải tiếp | Tiếp tục từ 738.636.221 byte, không tải lại từ 0 |
| **Tắt app khi đã tải 1,45 GB**, mở lại | Nút hiện "Tải tiếp"; tải tiếp từ 1.455.083.966 byte; cài xong, AI chạy |
| Sha256 của 2 file sau khi tải | Khớp Hugging Face (`dfce12e3…`, `539cf93f…`) |
| **Mất kết nối ở 300 MB** (máy chủ nội bộ cắt kết nối) | Tự thử lại, gửi `Range: bytes=314572800-`, sha256 đạt, cài xong. 10/10 PASS |
| **File hỏng** (đúng kích thước, sai nội dung) | Báo "checksum mismatch", xoá file hỏng; thư mục trống; AI không nạp mô hình hỏng. 6/6 PASS |
| **Không có file trên máy chủ** (404) | Báo lỗi ngay (dưới 30 s), không thử lại vô ích, không cài gì. 5/5 PASS |
| **Ổ đầy** (ổ ảo 300 MB) | Từ chối trước khi tải, báo "Không đủ dung lượng: cần 4.9 GB, thư mục mô hình chỉ còn …" (ổ 300 MB). 5/5 PASS |
| **Tắt rồi mở lại app** sau khi tải | Mô hình tự nạp: `qwen2.5-7b-instruct-q4_k_m`, Metal. AI trả lời tiếng Việt "200 mm = 0.2 mét." (38,8 token/giây) |

## Hồi quy
- 20 bộ smoke trên trình duyệt: không có FAIL.
- e2e desktop đều đạt: `e2e_cad` 12/12, `e2e_aichat` 3/3, `e2e_voice` 3/3, `e2e_scan` 6/6, `e2e_bimviews` 11/11, `e2e_layouts` 5/5, `e2e_part` 4/4, `e2e_batch` 4/4, `e2e_gpu` 4/4.
- **Sửa thêm trong đợt này:**
  - Kiểm thử tự động (`THCAD_QA=1`) giờ dùng hồ sơ trình duyệt riêng `thcad-qa`, không bao giờ mở hay sửa bản vẽ và cài đặt của người dùng.
  - Trong trang Cài đặt, các khung không còn bị ép nhỏ để nội dung tràn đè lên khung bên dưới; cột nội dung sẽ cuộn thay vì bị ép.

## Ảnh (`qa/`)
- `model_download_vi_start.png`: chưa có mô hình; 7B được khuyên dùng; có dung lượng trống.
- `model_download_vi_progress.png`: đang tải, có tốc độ, thời gian còn lại, phần 1/2.
- `model_download_vi_done.png`: "Đã cài và chạy thử…"; nhãn "Mô hình sẵn sàng".
- `model_download_vi_manage.png`: khi AI đã sẵn sàng, khối tải nằm trong "Quản lý mô hình".
- Bản tiếng Anh: `model_download_progress.png`, `model_download_paused.png`, `model_download_done.png`, `model_download_checksum.png`, `model_download_nospace.png`.

## Chưa kiểm chứng
- Tải trên máy Windows thật. Code dùng chung (Qt Network, QStorageInfo) và CI build bằng MSVC, nhưng chưa chạy tải trên Windows.
