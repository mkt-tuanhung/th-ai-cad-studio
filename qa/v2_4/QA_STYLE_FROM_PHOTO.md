# QA — "Ảnh mẫu → phong cách nội thất" (v2.4, tính năng B)

Ngày: 2026-10-19 · Nhánh: `worktree-agent-aec60425953eab4c3` · Máy kiểm thử: MacBook Pro M1 Max 32 GB (Metal), Blender 5.2.2
Nguyên tắc: chỉ ghi "Đạt" cho bài đã chạy thật (có số PASS / mã thoát). Ảnh demo: `~/Downloads/MD_CAD_DEMO_ANH_MAU_PHONG_CACH/`.

## 1. Tính năng làm gì

Người dùng thả 1–5 ảnh mẫu (Pinterest, tạp chí, công trình đã làm) vào **Nội thất → Trợ lý AI → Gợi ý** (ô "Phong cách từ
ảnh mẫu", nằm đúng chỗ các thẻ gợi ý DEMO cũ) hoặc thả thẳng lên **một phòng trên mặt bằng**. Ứng dụng:

1. **Đo bảng màu bằng code** (k-means trong không gian Lab, có hạt giống cố định → cùng ảnh cho cùng kết quả): tỉ lệ diện tích,
   vị trí trong khung (tường ở cao, sàn ở thấp), độ "nhám" bề mặt; đoán vai trò từng màu (tường, sàn, gỗ, vải, điểm nhấn, kim loại).
2. **Đọc phong cách bằng mô hình AI đọc ảnh chạy trên máy** (Qwen2.5-VL-7B-Instruct, GGUF Q4_K_M + mmproj Q8_0) qua chương trình
   phụ `llama-mtmd-cli` của llama.cpp. Câu trả lời bị **ép bằng ngữ pháp GBNF** thành một JSON chỉ chứa các mã có trong ứng dụng
   (8 phong cách, vật liệu từng bề mặt, 20 loại đồ, ánh sáng, độ tin cậy, mô tả tiếng Việt), rồi **kiểm tra lại** bằng code
   (`validateAnalysis`) — câu trả lời sai lược đồ bị loại, không bao giờ dùng mù.
3. **Không có mô hình**: phân tích cơ bản theo màu + độ nhám, ghi rõ **"phân tích cơ bản (chưa cài mô hình AI đọc ảnh)"**, độ tin cậy ≤ 40 %.
4. **Xem & chỉnh** (hộp thoại 3 bước, tiếng Việt): phong cách, bảng màu (sửa màu / vai trò), **vật liệu từng bề mặt** (sàn, tường, trần,
   đồ gỗ, vải bọc, kim loại, đá — chọn trong danh sách, hiện mã vật liệu thư viện Poly Haven tương ứng), đồ nội thất (bỏ chọn để không
   đặt), ánh sáng (ấm / trung tính, ngày / tối), mô tả, JSON phân tích.
5. **Phương án**: tối đa 3 phương án bố trí (A/B/C, từ bộ sinh phương án của Bố trí không gian — đúng kích thước thật của danh mục,
   tôn trọng cửa, lối đi, đồ đã khoá) **+ phương án K "giữ bố trí hiện tại — chỉ đổi phong cách"**. Mỗi phương án được kiểm lại:
   không chồng lấn, nằm trong phòng, **trước mỗi cửa thông thủy ≥ 800 mm**, không phát sinh lỗi khoảng trống / lối đi. Phòng chưa có
   cửa: lấy cửa đo trong mô hình BIM (liệt kê cho người dùng); không có thì báo "cần nhập cửa", không đoán. **Chưa áp dụng gì cho đến
   khi chọn**; Xem trước hiện trên mặt bằng / 3D; Áp dụng = **một bước hoàn tác**.
6. **Áp dụng** đổi: hoàn thiện phòng (sàn / tường / trần), vật liệu từng phần của đồ (sofa, ghế, bàn, giường, kệ, đèn, thảm), mẫu 3D
   thư viện hợp phong cách + kích thước (chỉ để render), thêm thảm / cây khi danh sách đồ có và vẫn đạt kiểm tra. **Ván tủ tham số
   (dữ liệu sản xuất) không đổi**, trừ khi người dùng tự tick "Áp cả vật liệu đồ gỗ cho ván tủ (thay đổi dữ liệu sản xuất)".
7. **Render phối cảnh**: 1–3 góc nhìn kiến trúc (mắt 1,3 m, máy ảnh cân bằng) chọn để thấy món chính (sofa / giường) từ phía trước,
   preset ánh sáng theo tâm trạng (trung tính + ngày → ban ngày; ấm + ngày → chiều nắng ấm; tối → buổi tối bật đèn), Blender Cycles qua
   hàng đợi Renders (thấy cả ở màn Renders), ảnh **đặt cạnh ảnh mẫu**; provenance ghi `presentationOnly: true`.

Không đổi bố cục màn hình nào: khối mới nằm trong ô thẻ gợi ý sẵn có (cùng header, 2 thẻ 93/88 px, dải 14 px); hộp thoại dùng `Modal`.
Trên trình duyệt (bản xem trước pixel-lock) vẫn hiện thẻ DEMO cho tới khi người dùng thả ảnh.

## 2. Cách dùng
1. **Cài mô hình đọc ảnh** (một lần): Cài đặt → Mô hình AI → **Quản lý mô hình** → khối "Mô hình đọc ảnh mẫu" → **Tải** (5,54 GB;
   tạm dừng / tải tiếp; kiểm tra sha256 từng tệp; cài vào `<thư mục mô hình>/vision/`). Không cài vẫn dùng được (phân tích cơ bản).
2. Mở **Nội thất**, chọn phòng (hoặc Bối cảnh phòng trong Trợ lý AI).
3. Thả 1–5 ảnh vào ô "Phong cách từ ảnh mẫu" (hoặc bấm **Chọn ảnh…**, hoặc thả lên phòng trên mặt bằng). Chờ ~15–25 giây.
4. **Xem & chỉnh** → sửa nếu cần → **2. Phương án** → **Tạo phương án** → **Xem trước** → **Áp dụng** (⌘Z để hoàn tác).
5. **3. Phối cảnh** → chọn số góc nhìn, ánh sáng → **Render phối cảnh** → ảnh render hiện cạnh ảnh mẫu.

## 3. Lựa chọn kỹ thuật
- **Chương trình phụ `llama-mtmd-cli`** (như `whisper-cli`), không link `libmtmd` vào app: mô hình 7B cần ~5,5 GB khi đọc ảnh — chạy
  riêng thì trả lại bộ nhớ ngay khi xong, mô hình chữ trong app không bị đụng; lỗi GPU / driver không làm sập app; trên Windows app
  link `llama-cpp` của vcpkg (không có thư viện đa phương thức). Chương trình phụ chỉ nhận tệp cục bộ (`-m`, `--mmproj`, `--image`,
  `--grammar-file`), không bao giờ nhận URL (`-hf`…) → không mở kết nối mạng.
- Ghim phiên bản: llama.cpp tag **b11429** (sha256 nguồn `0487b2e5…db6d7`), mô hình `ggml-org/Qwen2.5-VL-7B-Instruct-GGUF`
  revision `508edd0a…`, sha256 từng tệp (xem `native/third_party/llama-mtmd/README.md`).
- macOS: `native/third_party/llama-mtmd/build_macos.sh` dựng bản tĩnh (Metal nhúng, chỉ link framework hệ thống) → `Contents/Helpers/`.
  Windows: `build_windows.ps1` dựng từ cùng nguồn với **Vulkan + mọi biến thể CPU** vào `vision\` kèm DLL ggml riêng, chạy thử `--help` trong CI.

## 4. Đo trên máy này (M1 Max, Metal)
| Việc | Kết quả đo |
|---|---|
| Đọc 1 ảnh (mô hình đã nằm trong bộ nhớ đệm đĩa) | **13,6 – 18,8 giây** (3 lần chạy e2e: 14,1 · 13,9 · 18,7 · 18,8 · 13,6 · 18,8 · 13,9 · 13,9 s; ngoại tuyến 16,4 s) |
| Đọc 2 ảnh cùng lúc | **16,2 – 16,3 giây** |
| Lần đọc đầu sau khi khởi động máy / chương trình phụ mới | 24,8 s (r5, ảnh đầu); dòng lệnh: 29–32 s (đọc 5,5 GB từ đĩa + biên dịch shader Metal lần đầu) |
| Riêng mã hoá ảnh (mmproj) | ~1,1–1,3 s / ảnh 768 px |
| Render Blender Cycles 1600×900, 128 mẫu + khử nhiễu, phòng khách Villa 150 | **64 – 78 giây / góc nhìn** |
| Bộ nhớ thêm khi đọc ảnh | ~5,5 GB (chương trình phụ, trả lại khi xong) |

Chất lượng (ảnh CC0 trong `qa/v2_4/fixtures/style/`, kết quả JSON trong thư mục demo):
| Ảnh | Mô hình đọc được | Nhận xét |
|---|---|---|
| Phòng khách Bắc Âu (sofa xanh, sàn xương cá, tường trắng) | scandinavian 0,95 · sàn xương cá · tường trắng ấm · đồ gỗ sơn trắng · vải xanh · crôm | Đúng |
| Loft gạch thẻ (sofa xám, sàn gỗ tối) | industrial 0,95 · **tường gạch** · trần vữa · vải be · kim loại đen | Phong cách, tường đúng; **sàn đoán xương cá (ảnh là ván gỗ tối)**, vải be (ảnh xám) |
| Tường ốp gỗ tối | classic 0,95 · tường / trần / đồ gỗ màu tối | Đúng phần gỗ; sàn lại đoán xương cá |
| 2 ảnh tối giản (trắng, sofa xanh) | scandinavian 0,95 · tường trắng tinh · vải xanh | Hợp lý |

Ghi chú trung thực: mô hình 7B **thiên về chọn "sàn gỗ xương cá"** khi thấy sàn gỗ — đã thử thêm trường mô tả trước, đổi tên mã, tăng
số token ảnh (1024): không ổn định hơn. Người dùng sửa ở bước 1 (một ô chọn). Độ tin cậy mô hình tự báo (0,85–0,95) **không phải xác suất đúng**.

## 5. Kiểm thử đã chạy (thật)
| Bài | Lệnh | Kết quả |
|---|---|---|
| Kiểu TypeScript | `cd ui && npx tsc --noEmit -p tsconfig.app.json` | sạch (rc 0) |
| Unit mới | `UNIT=styleref node tools/test-cam.mjs run` | **ALL PASS** — ngữ pháp (mọi luật được định nghĩa, mỗi bề mặt chỉ có vật liệu hợp lệ), câu trả lời thật của mô hình hợp lệ, 8 kiểu câu trả lời sai bị từ chối, bảng màu (tất định, tường / sàn / điểm nhấn đúng), phân tích cơ bản (gỗ, xanh, gạch → industrial), ánh xạ vật liệu ↔ texture thư viện, chọn mẫu 3D theo phong cách, phương án: không chồng lấn (kiểm độc lập bằng SAT), trong phòng, cửa ≥ 800 mm, kích thước thật, đồ khoá giữ nguyên, phòng khác không đổi, ván tủ chỉ đổi khi tick, một bước hoàn tác, tất định, thiếu cửa → cần nhập, cửa lấy từ BIM |
| Unit liên quan | `UNIT=library / render / spaceplan / fromcad / auto / linked / platform / chat` | tất cả ALL PASS |
| Smoke trình duyệt mới | `node tools/smoke-stylephoto.mjs` | **7/7** (thả 2 ảnh → phân tích cơ bản có nhãn, hộp thoại, phương án A–C + K, áp dụng 1 bước hoàn tác, thả ảnh lên phòng trên mặt bằng, không lỗi console) |
| 24 smoke cũ | chạy từng tệp bằng `node`, dev server riêng :5288 | **24/24 rc 0**, 0 FAIL (ai 21, auto 9, bim-draw 12, bim 19, brand 7, cad2d 25, civil-tools 7, civil 12, components 18, fromcad 12, interior-plan 17, interior 19, linked 11, mechanical 13, mep-draw 8, mep 11, part 8, projects 21, renders 14, route 9, scan 13, settings 20, survey 12, smoke 17) |
| E2E desktop mới | `native/app/resources/e2e_stylephoto.js` (Villa 150 dựng bằng "1 lệnh" từ `VILLA_150_MASTER.dwg`, 5 ảnh / 4 nhóm) | **45 PASS / 0 FAIL, E2E DONE OK** (3 lần chạy liên tiếp sau các lần sửa: r4, r5, r6) (cài mô hình qua Cài đặt, đọc bằng mô hình 4 nhóm, áp dụng phương án A cho P. KHÁCH THÔNG TẦNG 2 phong cách, 4 ảnh Blender, provenance chỉ trình bày, ảnh cạnh nhau, hoàn tác / làm lại) |
| E2E tải mô hình (tiếp tục) | `e2e_visiondl.js` (mmproj cắt còn 400 MB `.part`, tải tiếp thật từ Hugging Face) | **6/6 PASS** — tải tiếp bằng HTTP Range (không từ 0), sha256 khớp (`2ddb5553…`), cài vào `vision/`, chương trình phụ thấy mô hình |
| E2E hồi quy | `e2e_aichat` · `e2e_library` · `e2e_blender` (chạy A, có Blender) | **3/3 · 26/26 · 34/34 PASS**, E2E DONE OK |
| Selftest + ngoại tuyến | `qa/tools/offline-run.sh` (selftest, mạng bị chặn, lấy mẫu socket) | **19/19 PASS**, 0 kết nối ra ngoài (47 lần lấy mẫu) |
| Đọc ảnh ngoại tuyến | `offline-run.sh` + `e2e_visionoffline.js` (cả tiến trình `llama-mtmd-cli` được lấy mẫu) | **6/6 PASS**, 0 kết nối ra ngoài (378 socket loopback của dev UI), đọc 16,4 s, tệp không phải ảnh bị host từ chối |
| Chưa chạy | `e2e_modeldl.js` (tải 4,7 GB mô hình chữ vào thư mục trống) | đường tải mô hình chữ không đổi; chỉ thêm trường `subdir/revision/kind` vào danh mục — đã kiểm gián tiếp bằng `e2e_visiondl` |
| SBOM | `node tools/make-sbom.mjs && node tools/check-sbom.mjs --selftest` | ok, 0 vấn đề (thêm chương trình phụ + 2 tệp mô hình) |

## 6. Giới hạn (nói thẳng)
- Mô hình 7B đọc **phong cách và tường** tốt, **nhận dạng hoa văn sàn kém** (hay chọn xương cá), màu vải đôi khi lệch — luôn xem lại bước 1.
- Bảng màu đo bằng code là màu trung bình của vùng ảnh (ánh sáng ảnh ảnh hưởng); vai trò màu là đoán theo vị trí.
- Vật liệu là **25 hoàn thiện mới + 15 cũ** của ứng dụng (mỗi cái gắn texture Poly Haven CC0 nếu đã tải thư viện; gạch thẻ là vật liệu
  thủ tục). Không có texture riêng cho mây tre, sơn bóng.
- Mẫu 3D theo phong cách chọn trong **thư viện đã tải** (60 mẫu Poly Haven phần lớn hiện đại / cổ điển); không có mẫu phù hợp thì
  render dùng khối tham số. Sofa "hiện đại" của Poly Haven có dạng chần nút.
- Bố trí đồ dùng các mẫu sẵn của Bố trí không gian (phòng khách / ngủ / bếp); danh sách đồ của ảnh chỉ thêm **thảm, cây** — bàn làm
  việc, ghế bành vàng… trong ảnh không được tự đặt thêm.
- Góc nhìn render: chọn tự động để thấy sofa từ phía trước; phòng hẹp nhiều đồ có thể cho 2 góc gần giống nhau.
- Kiểm thử trên macOS; Windows chỉ được giữ biên dịch (MSVC) — CI sẽ dựng và chạy thử `llama-mtmd-cli --help`.

## 7. Thư mục demo
`~/Downloads/MD_CAD_DEMO_ANH_MAU_PHONG_CACH/` (lần chạy e2e cuối):
- `01_anh_mau/` — 5 ảnh mẫu CC0 + nguồn; `02_phan_tich_json/` — JSON phân tích từng nhóm (kèm câu trả lời thô của mô hình, thời gian, phương án áp dụng, phòng sau khi áp dụng);
- `03_render/` — 4 ảnh Blender 1600×900 (Bắc Âu ×2, Công nghiệp ×2) + provenance (`presentationOnly: true`);
- `04_so_sanh_canh_nhau/` — ảnh mẫu | render; `05_anh_man_hinh/` — Cài đặt, khối AI, bước Phân tích / Phương án / Phối cảnh.

## 8. Việc cho người gộp nhánh (Windows CI)
- `native/packaging/windows/build_windows.ps1` bước 5c2 mới: tải nguồn llama.cpp b11429 (sha256 ghim), dựng `llama-mtmd-cli` với
  Vulkan + CPU (`GGML_BACKEND_DL`, `GGML_CPU_ALL_VARIANTS`) vào `vision\`, kiểm tra có `ggml-vulkan.dll`, `mtmd.dll`, chạy `--help`.
  Chưa chạy trên Windows — cần xem log CI lần đầu (tên tuỳ chọn CMake của bản b11429, thời gian dựng thêm ~5–10 phút).
- `native/app/src/vision_runner.cpp` mới (Qt, không gọi POSIX) — biên dịch MSVC chưa thử trên máy này.
- `native/package_macos.sh` dựng và chép `llama-mtmd-cli` tĩnh vào `Contents/Helpers/` (đã dựng thử `build_macos.sh`: chỉ link framework hệ thống).
