# QA — AI cục bộ thật (Qwen2.5-3B-Instruct, llama.cpp, Metal)

Ngày: 2026-10-10 · MacBook M1 Max 32 GB · mô hình `qwen2.5-3b-instruct-q4_k_m.gguf` (2.10 GB, tải từ
`Qwen/Qwen2.5-3B-Instruct-GGUF`, SHA-256 `626b4a66…5c62d` khớp bản phát hành) đặt tại
`~/Library/Application Support/TH AI CAD Studio/models/`. Không mạng, không API key, không Python.

## Cách AI được phép thay đổi bản vẽ

yêu cầu → mô hình sinh JSON thao tác → engine C++ phân tích + **kiểm tra** → **đề xuất** (bản vẽ chưa đổi,
hiện +thêm/−xoá/~sửa) → người dùng **Duyệt** → engine kiểm tra lại với bản vẽ hiện tại và ghi thành **1 bước
hoàn tác** → giao diện áp dụng cùng thao tác. Từ chối = không có gì thay đổi.

Các cơ chế engine (không phụ thuộc câu hỏi cụ thể):
- **Giải mã hybrid**: sinh tự do (nhanh); nếu kết quả không hợp lệ thì sinh lại với **ngữ pháp GBNF** (chỉ cho
  phép JSON đúng schema, tên layer có thật, ID có thật trong bản vẽ).
- **Toạ độ tương đối AutoCAD** (`"@3600<0"`, `"@dx,dy"`) và loại hình `rect` (góc + rộng + cao): engine làm
  phép tính, không bắt mô hình 3B cộng trừ.
- **`eraseWhere`** (lọc theo layer/loại, như QSELECT): engine tự tìm ID; đề xuất hiển thị ID cụ thể.
- Engine tự đổi ID bị trùng, chuẩn hoá đa tuyến kín lặp điểm đầu, từ chối hình học suy biến.

## Độ chính xác (`thcad-cli ai-eval`, kết quả đầy đủ: `ai_eval_qwen2.5-3b.txt`)

| Bộ câu | Hybrid (mặc định) | Chỉ ngữ pháp | Tự do |
|---|---|---|---|
| Bộ tinh chỉnh (12 câu, đã dùng để chỉnh prompt) | 12/12 · 1.8 s | 12/12 · 2.6 s | 10/12 · 1.5 s |
| Kiểm tra A (10 câu; **đã dùng để ra quyết định** → không còn khách quan) | 10/10 · 2.0 s | 10/10 | 8/10 |
| **Kiểm tra B (10 câu mới, chốt trước khi chạy — số liệu trung thực)** | **7/10 · 2.2 s** | 7/10 | 6/10 |

JSON hợp lệ 100% ở mọi bộ. Tốc độ sinh ~70–80 token/s (tự do), ~29 token/s khi có ngữ pháp; token đầu
~0.2–0.8 s. Bộ nhớ mô hình: 1.95 GB.

**3 lỗi ở bộ B** (đều hiện rõ trong đề xuất trước khi duyệt):
1. "Vẽ hình vuông cạnh 1200…" → vẽ thêm một đường tròn không được yêu cầu (+2 thay vì +1).
2. "Xóa tất cả đường tròn." → xoá bằng danh sách ID và bỏ sót 1 đường tròn (−1 thay vì −2).
3. "…2500 mm line going straight down…" → viết `@0<270` (độ dài 0); **engine từ chối** (hình học suy biến).

## Kiểm thử đầu-cuối trong app (`native/app/resources/e2e_ai.js`, chạy trên bản build và bản đóng gói)

7/7: mô hình nạp & sẵn sàng · chat mới không có nút cũ · đề xuất hiện sau **2.3 s** · bản vẽ không đổi trước
khi duyệt · đề xuất báo đúng +1 · sau duyệt có đúng 1 đường tròn r=600 tại 3000,3000 trên A-Furniture trong
"Villa Riverside - Floor Plan.dwg" · thẻ Local AI trên Dashboard hiện tên mô hình thật và tốc độ đo được.
Ảnh: `native_ai_live_proposal.png`, `native_ai_live_approved.png`, `native_ai_live_cad2d.png`,
`native_dashboard_live_ai.png`.

## Lỗi thật đã tìm ra và sửa nhờ kiểm thử
- ID do AI đặt trùng với bản vẽ (`ai-1` lặp) → engine đổi ID; bộ đếm đề xuất chịu được ID trùng có sẵn.
- Lượt chat "đang chờ" bị lưu khi tắt app → khoá nút Gửi; nay đánh dấu "bị ngắt"/"hết hạn" khi mở lại.
- Bài test cũ bấm nhầm nút của phiên mẫu (kết quả "0.0 s" không hợp lệ) → đã loại bỏ.

## Khuyến nghị
Mô hình 3B đủ cho lệnh vẽ đơn giản nhưng còn "làm thừa"/"bỏ sót" ở ~30% câu mới. Bước xem trước + duyệt là bắt
buộc và đang chặn được các lỗi này. Nên thử **Qwen2.5-7B-Instruct Q4_K_M (~4.7 GB)** trên cùng 3 bộ câu.

---

# So sánh Qwen2.5-3B và Qwen2.5-7B (2026-10-11)

Mô hình 7B: `Qwen/Qwen2.5-7B-Instruct-GGUF`, `q4_k_m` chia 2 tệp (3.99 GB + 0.69 GB), SHA-256 cả hai tệp khớp
bản phát hành. Cùng engine, cùng prompt, cùng 4 bộ câu, nhiệt độ 0. Kết quả đầy đủ: `qa/ai_compare/`.

## Độ chính xác (chế độ hybrid mặc định)

| Bộ câu | 3B | 7B | Ghi chú |
|---|---|---|---|
| Tinh chỉnh (12) | 12/12 | 12/12 | đã dùng để chỉnh prompt |
| Kiểm tra A (10) | 10/10 | 10/10 | đã dùng để ra quyết định |
| **Kiểm tra B (10)** — sạch | **7/10** | **10/10** | |
| **Kiểm tra C (12)** — lần chạy đầu, sạch | **9/12** | **11/12** | cả hai viết góc cung tròn bằng độ |
| Kiểm tra C sau khi engine nhận góc bằng độ | 10/12 | 11/12 | câu cung tròn không còn khách quan |
| **Câu chưa gặp (B + C lần đầu)** | **16/22 (73%)** | **21/22 (95%)** | mẫu nhỏ — xu hướng rõ, con số chính xác còn dao động |

Lỗi còn lại của 7B: đường gấp khúc chuyển toạ độ tuyệt đối sang tương đối và sai hướng đoạn cuối
(`"@2000<90"` thay vì `"@2000<0"`). Lỗi của 3B: làm thừa (thêm đường tròn, thay đường gấp khúc bằng cung),
bỏ sót khi xoá, lặp khoá JSON làm mất một đối tượng.

## Tốc độ và tài nguyên (M1 Max 32 GB)

| | 3B | 7B |
|---|---|---|
| Thời gian / yêu cầu (hybrid) | 1.7–2.2 s | 3.1–3.3 s |
| Đầu-cuối trong app (gửi → đề xuất hiện) | 2.3 s | 3.3–3.6 s |
| Tốc độ sinh (tự do / có ngữ pháp) | ~80 / ~30 token/s | ~42 / ~23 token/s |
| Trọng số trong bộ nhớ hợp nhất | 1.95 GB | 4.36 GB |
| Dung lượng trên đĩa | 2.10 GB | 4.68 GB |
| Lần thử lại hybrid (trên 44 câu) | 8 | 0 |

Với 7B, giải mã tự do đã gần như luôn hợp lệ nên chế độ hybrid hầu như không phải thử lại.

## Quyết định trong engine

Engine tự chọn **mô hình lớn nhất có trọng số ≤ 35% bộ nhớ máy**: máy 32 GB → **7B**; máy 8 GB → 3B.
Ghi đè bằng `THCAD_MODEL=/đường/dẫn.gguf` hoặc tệp `models/default.txt` (một dòng: tên tệp).
Kiểm thử đầu-cuối trong app đạt 7/7 với cả 7B và 3B, trên bản build và bản đóng gói.

## Sửa trong engine nhờ đợt so sánh
- Cung tròn: phía AI dùng **độ** (`startDeg`/`endDeg`, quy ước AutoCAD); engine đổi sang radian.
- Tự tìm mô hình bỏ qua tệp phần 2 trở đi của GGUF chia nhỏ; tên hiển thị bỏ đuôi `-00001-of-00002`.
