# QA — Bộ kết xuất (Renders, mục 2)

Bộ kết xuất chạy **trong app desktop**: OCCT ray tracing / path tracing trên GPU (OpenGL 4.1 core trên macOS), miễn phí, không thêm thư viện. Trong trình duyệt thường hàng đợi vẫn ở trạng thái "Đang chờ — chưa kết nối bộ kết xuất" (không giả lập).

## Luồng

Render Current View / Batch Render / nút ▶ trên dòng → `renders/runner.ts` dựng job (cảnh của camera + thiết lập + hậu kỳ chụp lại lúc xếp hàng) → `HostBridge::renderStart` → `SceneView::beginRender` + `renderPasses` (lát ~25 ms, nghỉ 20 ms để giao diện vẫn mượt) → tín hiệu `renderProgress` (tiến độ, ảnh xem trước mỗi 1,5 s) → khử nhiễu (tuỳ chọn) → hậu kỳ → ghi file vào `Documents/TH AI CAD Studio/Renders/`.

| Thiết lập | Áp dụng thật |
|---|---|
| Độ phân giải, DPI | kích thước ảnh, DPI ghi trong PNG/JPEG |
| Định dạng | PNG 8-bit, PNG 16-bit (đọc buffer float), JPEG 95 %, TIFF (nếu Qt có plugin). OpenEXR: báo lỗi rõ — chưa có bộ ghi |
| Bộ kết xuất | Path Tracing → path tracing GI; Hybrid → path tracing tối đa 3 lần nảy; Rasterized Preview → ray tracing Whitted (≤ 16 lượt) |
| Samples / Max Bounces | số lượt tích luỹ / độ sâu tia; Render Quality là preset đặt hai giá trị này (Draft 64/3, Medium 256/4, High 1024/8, Ultra 4096/12) |
| Denoise | bộ lọc bilateral giữ biên 5 × 5 (không phải AI, không phóng to) |
| HDRI / Sun & Sky / Intensity / Direction | bầu trời cubemap tự sinh (Clear / Overcast / Studio / Night), mặt trời là đèn hướng có đĩa 1° (bóng mềm) |
| Hậu kỳ | Exposure qua tone mapping filmic; Contrast / Saturation / Temperature / Vignette áp lên ảnh cuối |
| Lớp | Architecture = toà nhà BIM, Landscape = mặt đất, Furniture = đồ nội thất |

Cảnh: camera ngoại thất / trên cao dùng **mô hình BIM** (tường có lỗ mở, kính cửa sổ, sàn mỗi tầng suy ra từ tường bao); camera nội thất dùng **mô hình nội thất** với tường cao tới trần (chưa có trần, cửa sổ, đèn phát sáng trong mô hình nội thất → ảnh nội thất là dạng "mở nóc").

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Tự kiểm tra trong app (`THCAD_SELFTEST=1`) | macOS (bản build và bản đóng gói `dist/`): 15/15, gồm "renderer: path-traced image produced" (job 64 × 48, không ghi file) |
| Windows CI (run 38171075113, Setup-0.1.0.exe 144 MB) | Build + tự kiểm tra đạt; bài render **SKIP** vì máy ảo chỉ có OpenGL 1.1 (GDI Generic) — chưa kiểm chứng trên máy Windows có GPU thật |
| 5 camera, 1920 × 1080, 256 mẫu, khử nhiễu (Batch Render từ giao diện) | `native_renders_5cams.jpg` — ngoại thất ~5 s/ảnh trên máy này |
| Màn Renders khi đang/đã kết xuất | `native_renders_studio.png` — ảnh thật thay ảnh DEMO, nhãn "OCCT render · 256 samples · 0:05 · tên file", hàng đợi Done/Rendering/Waiting, Lịch sử |
| Thử đèn (hộp trên sàn: path tracing / Whitted) | `native_render_light_test.png` |
| Smoke trình duyệt renders / interior / mep / mechanical | 11/11 · 12/12 · 11/11 · 12/12 |

## Lỗi đã gặp và cách sửa

- Shader skydome của OCCT 7.9 dùng GLSL 1.30, macOS (core 4.1 hoặc legacy 2.1) không hỗ trợ → crash. Thay bằng cubemap bầu trời tự sinh.
- macOS mặc định context OpenGL 2.1 (không ray tracing) → bộ kết xuất dùng context core profile riêng.
- Path tracing của OCCT coi cường độ đèn hướng là radiance của đĩa mặt trời → mặt trời gần như không chiếu. Đặt radiance = độ rọi / góc khối của đĩa.
- Windows: máy không có ray tracing (OpenGL cũ) → job báo lỗi rõ ràng "this GPU/driver has no OpenGL ray-tracing support", không treo.
- Ảnh chụp cửa sổ QA bị trắng lúc 2 giờ sáng: màn hình tắt nên Chromium ngừng vẽ (không phải lỗi app) — chụp kèm `caffeinate -u`.

## Chưa có

- Bộ ghi OpenEXR; AI denoise/upscale, AI lighting/material/style (cần bộ kết xuất AI cục bộ).
- Trần, cửa sổ, đèn phát sáng trong mô hình nội thất; cây, người, hồ bơi trong cảnh ngoại thất (ảnh DEMO của mockup có, mô hình chưa có).
- Thống kê ở tab "Cảnh" vẫn là số liệu cảnh DEMO (có ghi chú).
