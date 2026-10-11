# QA — DWG, renderer 2D, đóng gói phát hành

Ngày: 2026-10-11 · Máy đo: MacBook Pro M1 Max 32 GB · Chromium headless (Playwright) + QtWebEngine.

## 1. Đọc bản vẽ thật (DWG → DXF → app)

Mẫu: 5 bản vẽ DWG có sẵn trên máy (chỉ đọc, xử lý cục bộ, không tải lên đâu). Chuyển sang DXF bằng
LibreDWG 0.14 `dwg2dxf` (cài qua Homebrew **chỉ để đánh giá**, GPL-3.0). Cả 5 tệp chuyển thành công
trong 0,03–0,31 s. LibreDWG có in cảnh báo (HATCH handles, "Unstable Class"), nhưng không có tệp nào lỗi.

Bộ nhập DXF mới `ui/src/cad/dxfImport.ts` thay cho bản cũ (chỉ đọc LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC/TEXT):
- **Đọc thêm:**
  - INSERT: block, block lồng nhau, mảng MINSERT, thuộc tính ATTRIB, block soi gương.
  - DIMENSION và ACAD_TABLE: bung từ block ẩn danh nên hình giống hệt AutoCAD.
  - HATCH: fill đặc → miền tô; pattern → chỉ vẽ biên.
  - Bulge của polyline (cung trong polyline), ELLIPSE, SPLINE (NURBS de Boor), LEADER, SOLID/TRACE, 3DFACE.
  - Lớp tắt/đóng băng, MTEXT (định dạng, `\U+`, `%%c/%%d/%%p`).
- **Không đọc:** POINT (AutoCAD vẽ thành chấm; điểm trên DEFPOINTS bỏ qua) và paper space. Mọi thứ bỏ qua
  hoặc chỉ vẽ xấp xỉ đều được đếm và in ra dòng lệnh.

| Bản vẽ | Đối tượng model space | Sau khi bung block | Bỏ qua | Thời gian nhập |
|---|---|---|---|---|
| VILLA_150 MASTER | 1 989 | 3 014 | paper space 100 | 53 ms |
| VILLA_150 PERMIT | 2 814 | 3 945 | paper space 228 | 34 ms |
| VILLA_150 MEP | 1 813 | 2 545 | paper space 70 | 11 ms |
| BanVe_KenhN2 | 329 | 328 | paper space 1 | 1 ms |
| BVTK Kênh Đức Phong | 26 481 | 41 717 | POINT 2 249 (không nằm trên DEFPOINTS) | 309 ms |

Kiểm chứng thêm:
- Bản vẽ 41 717 đối tượng lưu được và vẫn còn đủ sau khi reload.
- Ảnh chụp sau khi nhập: `gpu_vs_svg_villa.png` và `gpu_kenh_duc_phong.png` (prototype).

**Lỗi tìm ra và đã sửa trong lúc đo:**
1. Bản vẽ được lưu vào localStorage, chỉ chứa được khoảng 5 MB, nên bản vẽ lớn làm app báo lỗi
   `QuotaExceededError`. Đã chuyển sang `state/idbStorage.ts`:
   - Bản vẽ lưu trong IndexedDB (structured clone, không chuyển sang JSON).
   - Chỉ ghi khi bản vẽ đổi (so sánh tham chiếu), gộp các lần ghi, ghi ngay khi trang bị ẩn.
   - Cài đặt nhỏ vẫn ghi ngay vào localStorage.
   - Dữ liệu cũ trong localStorage được tự chuyển sang khi mở app lần đầu.
2. Bản vẽ mở sau tài liệu đầu tiên không tự Zoom Extents, vì cờ "đã fit" chỉ đặt một lần cho cả viewport.
   Giờ cờ này tính theo từng tài liệu.
3. Nếu nhập tệp trong lúc dữ liệu đang được nạp lại, bước nạp lại có thể ghi đè bản vẽ vừa nhập. Giờ app
   đợi nạp xong rồi mới nhập.

## 2. Có cần renderer 2D native không? — Đo thật

Đo bằng `ui/tools/bench-2d.mjs`. Mỗi lần đổi khung nhìn (pan/zoom) được tính đến khi vẽ xong; 33 ms là
mức sàn của phép đo, tương đương 2 lần vsync.

| Bản vẽ | Đối tượng | SVG dev | SVG production | Mở lần đầu (production) |
|---|---|---|---|---|
| VILLA MASTER | 3 014 | 50 ms | **33 ms** (mượt) | 0,23 s |
| Kênh Đức Phong | 41 717 | 650 ms | **267 ms** (~4 fps) | 1,7 s |
| Giả lập 100k | 100 000 | 1 337 ms | **551 ms** (~2 fps) | 1,9 s |
| Giả lập 200k | 200 000 | quá 20 s chưa vẽ xong | — | — |

Prototype vẽ cùng dữ liệu, đặt ngay trong web view. WebGL chạy qua ANGLE
Metal, tức cùng đường GPU mà QtWebEngine dùng:

| Dữ liệu | WebGL2 (đường) + Canvas (chữ) | Canvas 2D (tất cả) |
|---|---|---|
| Kênh Đức Phong: 176 489 đoạn thẳng, 8 763 chữ | **16,7 ms/khung (60 fps)**, nạp GPU 75 ms | 16,7 ms (60 fps) |
| Giả lập 200k: 1 120 000 đoạn thẳng, 20 000 chữ | **16,7 ms (60 fps)** | 33 ms (30 fps) |

**Kết luận:**
- SVG chỉ ổn đến khoảng 3–5 nghìn đối tượng, nên bản vẽ thi công thật phải đổi cách vẽ.
- **Không cần renderer native.** Lớp vẽ bằng GPU ngay trong web view đã đạt 60 fps với 1,1 triệu đoạn
  thẳng, mà vẫn tránh được lỗi chồng lớp giữa widget native và web (đã gặp với viewport 3D cũ).
- Cùng một mã chạy được trên Windows (ANGLE → D3D11).
- Chủ đầu tư đã chọn làm ngay (2026-10-11). Kết quả ở mục dưới.

### Đã làm: lớp vẽ GPU (`ui/src/screens/cad2d/gpu/`)

- **Cách chia việc:**
  - Bản vẽ không có underlay và có ≥ 2 000 đối tượng thì nét được vẽ bằng WebGL2. Mỗi đoạn thẳng là một
    quad instanced, độ dày tính đúng theo CSS px và có MSAA. Miền tô đặc được tam giác hoá bằng `earcut`.
  - Chữ vẽ bằng Canvas 2D: chỉ vẽ chữ nằm trong khung nhìn, bỏ chữ nhỏ hơn 1,2 px.
  - SVG chỉ còn lưới, đối tượng đang chọn và grip, bóng xem trước, OSNAP và con trỏ.
  - Toạ độ GPU tính tương đối với tâm bản vẽ, để số float32 không mất độ chính xác.
- **Bản vẽ mẫu Villa (mockup) vẫn vẽ bằng SVG**, nên các phép đo fidelity cũ vẫn giữ nguyên giá trị.
  Nếu không có WebGL2 hoặc mất context GPU, app tự quay về SVG.
- **So với SVG trên cùng bản vẽ VILLA:**
  - Ở mức zoom vừa khung, phần nét trùng 86% (IoU). Phần lệch là chữ nhỏ dưới 1–2 px.
  - Khi phóng to 8×, nhìn bằng mắt không thấy khác biệt.
  - Ảnh (trái là SVG, phải là GPU): `gpu_vs_svg_villa.png`, `gpu_vs_svg_villa_zoom8x.png`.

| Bản vẽ | Đối tượng | Đoạn GPU | Dựng dữ liệu | Pan/zoom (dev) | Mở lần đầu |
|---|---|---|---|---|---|
| VILLA MASTER | 3 014 | 21 230 | 3 ms | **33 ms** (mức sàn) | 0,30 s |
| Kênh Đức Phong | 41 717 | 166 389 | 42 ms | **33 ms** (trước đây 650) | 1,3 s |
| Giả lập 100k | 100 000 | 520 875 | 55 ms | **33 ms** (trước đây 1 337) | 0,85 s |
| Giả lập 200k | 200 000 | 1 041 007 | 120 ms | **33 ms** (trước đây không mở được) | 1,6 s |

- **Rê chuột khi đang vẽ (LINE, OSNAP bật):** bản 200k mất 66 ms, bản 328 đối tượng mất 50 ms (mức sàn của
  phép đo), tức là chậm thêm khoảng 1 khung hình. Muốn bỏ nốt phần này thì sau này thêm chỉ mục không
  gian cho OSNAP.
- **Trong app desktop thật** (`native/app/resources/e2e_gpu.js`): QtWebEngine có WebGL2 (ANGLE Metal);
  bản vẽ 2 700 đối tượng do lớp GPU vẽ; zoom có trung vị 33,3 ms. Ảnh: `native_gpu_large_dxf.png`.
- **Lỗi hiệu năng cũ đã sửa trong lúc làm:**
  - `unionBBox`/`bboxOf` dùng `Math.min(...mảng)` nên tràn stack khi có trên ~120k đối tượng; đây là lý do bản
    200k không zoom được.
  - Các chỗ tra cứu ID dùng `includes`/`find` chậm theo bình phương (ERASE/MOVE/REPLACE, khung Properties,
    bóng MOVE) đã đổi sang Set/Map.

**Còn thiếu trên đường GPU:**
- Nét đứt (linetype): bộ nhập chưa đọc bảng LTYPE, nên bản vẽ nhập vào đều là nét liền.
- Pattern của hatch (mới chỉ vẽ biên).
- Chữ dùng font Roboto thay cho font SHX của AutoCAD.

## 3. Đóng gói phát hành

| Hạng mục | Trạng thái |
|---|---|
| macOS `.dmg` | `native/packaging/macos/make_dmg.sh` → `dist/TH-AI-CAD-Studio-0.1.0-macOS-arm64.dmg` (~104 MB). Ký ad-hoc + **hardened runtime** + entitlements (JIT cho V8, `disable-library-validation` cho ggml) |
| Chạy từ DMG đã mount | selftest **10/10**, e2e_cad 12/12, e2e_bim3d 9/9, e2e_gpu 4/4, e2e_ai 7/7 (Qwen2.5-7B), không nạp thư viện nào từ `/opt/homebrew` |
| Developer ID + notarize | Script đã sẵn sàng (`DEVELOPER_ID=… NOTARY_PROFILE=…`). **Chưa chạy**: máy chưa có chứng chỉ (0 identity). Cần Apple Developer Program $99/năm — chỉ để bỏ cảnh báo Gatekeeper, **không bắt buộc** |
| Windows: mã nguồn | Đã tách phần riêng của macOS: số thực theo locale (`_strtod_l`), RAM (`GlobalMemoryStatusEx`), đường dẫn exe, thư mục model `%LOCALAPPDATA%`, cửa sổ OCCT (`WNT_Window`), title bar, AppKit chỉ dùng trên Apple, cờ MSVC |
| Windows: biên dịch thử | Lõi core/bim/ai + 31 test + CLI biên dịch chéo bằng MinGW-w64 → `thcad_tests.exe`, `thcad-cli.exe`, **0 lỗi** (chưa chạy được vì không có Windows/Wine) |
| Windows: bộ cài | `native/packaging/windows/build_windows.ps1` + `vcpkg.json` + `installer.iss` (Inno Setup, tiếng Anh/Việt) → `TH-AI-CAD-Studio-Setup-0.1.0.exe`. Workflow `.github/workflows/windows.yml` build trên máy Windows của GitHub Actions, chạy self-test rồi tải bộ cài lên mục artifact. **Chưa chạy**: chưa có repo |
| Windows: cửa sổ | Thanh tiêu đề trong suốt (`ExpandedClientAreaHint`) chỉ bật trên macOS; Windows giữ thanh tiêu đề chuẩn có nút thu nhỏ / phóng to / đóng |

**Không tuyên bố bản Windows chạy được** cho đến khi build và chạy thử trên Windows thật.
