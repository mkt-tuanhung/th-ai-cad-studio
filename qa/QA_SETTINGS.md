# QA — Màn 06: Settings & Local AI Models (Pixel-Lock v2)

- **Ngày:** 2026-10-11.
- **Chuẩn so sánh:** `../TH_AI_CAD_Studio_UI_LOCK_v2/mockups/06_Settings.png` (1586 × 992).

## Ảnh

| | Tệp |
|---|---|
| Mockup / app đặt cạnh nhau | `qa/v2/06_settings/side_by_side.png` |
| Overlay, difference | `qa/v2/06_settings/` (MAE 12.01) — trước đây là màn chờ `qa/v2/06_settings_before/` (MAE 11.04) |
| VI | `qa/v2/settings_vi.png` |
| App desktop, số liệu thật | `qa/v2/settings_native.png` |
| Kích thước khác | `qa/v2/settings_en_1440x900.png` (hai thẻ đặt cạnh nhau chuyển thành một cột), `qa/v2/settings_en_1920x1080.png` |

MAE không dùng được để chấm màn này: mockup gần như toàn nền trắng, nên màn chờ trắng trơn lại có MAE thấp
hơn. Thước đo chính là bbox mực in.

## Đo bbox 58 phần tử (`ui/tools/regions_settings.json` → `qa/v2/settings_inkbox.txt`)

| Lệch tối đa | Số phần tử |
|---|---|
| 0 px | 23 |
| 1 px | 13 |
| 2 px | 9 |
| 3 px | 5 |
| 4–5 px | 4 |
| 7–8 px | 4 |

- **45/58 phần tử ≤ 2 px.**
- 4 phần tử lệch 7–8 px:
  - Hai phần tử là lỗi đo (vùng đo lẫn cả công tắc hoặc chấm màu chú thích).
  - Chữ nút Save rộng hơn mockup.
  - Nhãn "Cache Size".

## Nội dung mockup đã sửa cho đúng (giữ bố cục)

| Mockup | App |
|---|---|
| "AutoCAD Assistant (Local)", "Model Ready", "VRAM 6.2 / 16 GB" | **App desktop:** tên model thật (`qwen2.5-7b-instruct-q4_k_m`, 4.4 GB), trạng thái thật (Ready), bộ nhớ thật (4.4 / 32 GB). **Trình duyệt:** ghi "Demo UI / Not connected" và gắn nhãn DEMO |
| "All Systems Ready" | Tính từ trạng thái thật: AI đã nạp model và có GPU (WebGL2). Trên trình duyệt ghi "Demo UI" |
| Đường dẫn `/Users/hoangtran/THAICAD/...` | Đường dẫn thật trên máy (`~/Documents/TH AI CAD Studio/…`, thư mục model của runtime) |
| Storage 42.6 / 200 GB | Số thật: model AI 6.3 GB, dự án 6.2 GB (cộng từ danh mục tệp), bộ đệm, dữ liệu app; tổng dung lượng ổ đĩa (460 GB) |
| Mặc định "DWG (AutoCAD 2021)" | Mặc định "DXF (R12 / AC1009)"; tuỳ chọn DWG bị khoá với ghi chú "chỉ đọc" vì app chưa ghi được DWG |
| Clear Cache "1.2 GB" | Dung lượng thật của bộ đệm (Cache Storage + nội dung tệp nhập trong phiên) |
| Theme Dark / System | Lưu được lựa chọn, nhưng giao diện vẫn sáng vì chưa có thiết kế tối được duyệt; app ghi chú rõ điều này |

## Cài đặt có tác dụng thật

- **Đơn vị, độ chính xác, đơn vị góc:** dùng cho hai lệnh mới **DIST** (DI) và **AREA** (AA) trong CAD 2D, và cho phần Preview.
  Thanh toạ độ CAD 2D giữ đúng 3 số lẻ như mockup 02.
- **Giao diện:** ngôn ngữ (toàn app); Compact UI (sidebar gọn); bật/tắt hiệu ứng (class `no-anim`);
  tắt tooltip (ẩn các `title`); Show Start Page (tắt thì mở lại màn cuối cùng).
- **Hardware Acceleration:** tắt thì CAD 2D quay về vẽ bằng SVG.
- **Use GPU for AI:** app desktop nạp lại model với hoặc không có offload GPU.
- **Max Undo Steps:** giới hạn số bước trong lịch sử của CAD 2D.
- **Phím tắt:** đổi được ⌘K, Undo, Redo, Save, Save As, F1, F3, F7, F8, F9, F10. Phím mới dùng ngay trong CAD 2D;
  app báo khi phím trùng.
- **Thư mục:** app desktop mở hộp chọn thư mục của hệ điều hành và mở thư mục trong Finder/Explorer. Đổi thư
  mục model thì runtime quét lại và nạp model. Trình duyệt dùng ô nhập đường dẫn.
- **Model:** chọn model trong danh sách → Save → app desktop nạp model đó.
- **Mọi thay đổi là bản nháp** (có chữ "Unsaved changes") cho đến khi bấm Save Changes. Reset to Default đưa bản nháp về mặc định.
- **Updates / Privacy / Integrations:** hiện thông tin thật — phiên bản engine, OCCT, AI backend, LibreDWG; không có mạng, không thu thập dữ liệu.
- **Help & Resources:** mở hướng dẫn trong app.

## Tương tác đã kiểm tra (`ui/tools/smoke-settings.mjs` — 16/16 đạt)

- Đủ 6 thẻ và cột phải.
- Trình duyệt không hiện trạng thái AI giả.
- Bản nháp: chưa lưu thì preview đổi nhưng giá trị đã lưu không đổi.
- Save lưu đơn vị, độ chính xác, đơn vị góc; cột phải cập nhật theo.
- DIST và AREA trả kết quả theo đơn vị đã lưu (5.000 m, 0.927 rad, 6.000 m², 10.000 m).
- Chuyển VI ↔ EN.
- Compact và no-anim được áp lên `<html>`.
- Theme Dark có ghi chú; tắt GPU thì CAD 2D vẽ bằng SVG.
- Max Undo = 10 → lịch sử CAD đúng 10 bước.
- Đổi phím OSNAP F3 → F4 và phím mới hoạt động trong CAD 2D.
- Đổi thư mục dự án; Reset về mặc định.
- Các mục Updates / Privacy / Integrations / Help; thu gọn và mở thẻ.
- Không có lỗi console.

Các bộ test cũ không hồi quy: Dashboard 14, CAD 2D 21, AI 14, BIM 16, Projects 18.

**Không tuyên bố giống 100%.**
