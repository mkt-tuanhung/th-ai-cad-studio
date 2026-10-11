# QA — Khung native (C++20 / Qt 6 / OCCT / llama.cpp)

Ngày: 2026-10-10 · Máy: MacBook M1 Max 32 GB, macOS 15.2 · Qt 6.11.2 · OCCT 7.9.3 · llama.cpp 0.6.0 (b11429)

| Kiểm tra | Kết quả |
|---|---|
| Kiểm thử đơn vị C++ (`native/build/tests/thcad_tests`) | **30/30 PASS** (cập nhật) — command bus, validate, batch nguyên tử, bảng lệnh/alias/toạ độ AutoCAD, JSON, ProposalQueue (preview không đổi bản vẽ, approve = 1 bước undo, tái kiểm tra khi approve), DXF R12 khứ hồi, BIM khối lượng + kiểm tra, AI không bịa, OCCT thể tích/boolean/STEP/công trình |
| Khối lượng BIM C++ = UI | W1–W5: 12.75/2.55 … 11.70/2.34; kiểm tra 0/3/5/0/0 — trùng 100% với bản TypeScript |
| OCCT boolean | W1 khoét D2 (900×2100) → giảm đúng 0.378 m³ (2.55 → 2.172) |
| Tự kiểm tra cầu nối trong app (`THCAD_SELFTEST=1`) | **10/10 PASS** trên bản build và bản đóng gói `dist/` |
| Bản đóng gói | 339 MB, ký ad-hoc, `codesign --verify --strict` OK, **0 thư viện nạp từ /opt/homebrew** (DYLD_PRINT_LIBRARIES) |
| UI chạy trong app | `native_dashboard.png`, `native_cad2d.png`, `native_ai-studio.png`, `native_bim.png` (Qt grab, 1528×927) |
| Trình xem 3D OCCT | `native_occt_3d_viewer.png` — 24 tường đặt đúng tầng, lỗ cửa đi/cửa sổ, view cube |
| `thcad-cli` | script RECTANG/LINE/CIRCLE/UNDO/TEXT → DXF → ép đùn 3000 mm → STEP |
| Hồi quy UI trên trình duyệt | Dashboard 14/14 · CAD 2D 19/19 · AI Studio 14/14 · BIM 16/16 |

## Cập nhật (cùng ngày) — đã làm tiếp

| Kiểm tra trong app (bản build **và** bản đóng gói `dist/`) | Kết quả |
|---|---|
| Tự kiểm tra cầu nối | 10/10 |
| AI thật qua giao diện (`e2e_ai.js`) | 7/7 — xem `QA_AI_LOCAL.md` |
| CAD 2D ⇄ Command Bus C++ (`e2e_cad.js`) | 12/12 — gồm engine từ chối → giao diện tự hoàn tác |
| BIM 3D OCCT trong slot web (`e2e_bim3d.js`) | 9/9 — `native_bim3d_shaded.png`, `native_bim3d_hidden.png`, `native_bim3d_selected.png`, `native_bim3d_edited.png`, `native_occt_offscreen_modes.png` |
| Thư viện nạp từ /opt/homebrew (bản đóng gói) | 0 |

## Engine 3D OCCT cho Cơ khí / Nội thất / MEP (`SceneView`, `thcad-cli scene`)

UI chuyển mô hình từng bộ môn thành primitive → C++ dựng solid B-rep chính xác, render offscreen, pick bằng giao tia–mặt, đo thể tích, kiểm tra giao nhau bằng boolean common, xuất STEP. Chế độ Chân thực (và trình duyệt thường) vẫn là ảnh DEMO có nhãn.

| Kiểm tra | Kết quả |
|---|---|
| Hướng khung hình (sửa lật dòng 2 lần trong `renderRgba`, cả BIM) | Đế bơm ở dưới, họng xả hướng lên — `native_mech3d_home_front.png`; BIM đứng đúng — `native_bim3d_upright.png` |
| Cơ khí: bơm ly tâm tham số, 9 solid, chọn/nổ/STEP/giao nhau | `native_mech3d.png` — mặc định 0 giao nhau; Impeller_Dia 240 → cánh∩vỏ 16,1 cm³ |
| Nội thất: 9 phòng + tường cắt 1100 mm + 12 vật dụng, 30 solid, build ≈ 100 ms | `native_interior3d.png` |
| Tủ dựng từng tấm theo bảng cắt — thể tích ván 3D = bảng cắt | c1 0,118045 · c2 0,150583 · c3 0,313846 m³ khớp tuyệt đối; app hiện "3/3 tủ khớp" |
| Dữ liệu mẫu nội thất | OCCT phát hiện 2 cặp phòng chồng nhau (Phòng ngủ 1 ↔ Bếp, Giặt ↔ Phòng ngủ 2) → sửa outline + thêm luật kiểm tra chồng phòng |
| MEP: ống gió/ống nước/dầm của tầng, 34 solid, build ≈ 25 ms | `native_mep3d.png` — va chạm theo luật tô đỏ |
| MEP kiểm tra chính xác OCCT (Tầng 2) | 7 cặp giao nhau, 6 cặp ngoài bộ luật (ống gió–ống gió, ống nước–ống nước) — hiện ở tab Kiểm tra va chạm |
| Smoke trình duyệt nội thất / MEP / cơ khí | 12/12 · 11/11 · 12/12 |

Giới hạn: thiết bị MEP và mạch điện chưa có toạ độ trong mô hình nên không vẽ; vị trí đồ nội thất là layout mặc định (vật dụng mới đặt theo lưới 1,2 m quanh tâm phòng); sofa/bàn đặt trên thảm được tính là tiếp xúc, không phải va chạm.

## Chưa kiểm chứng được

- Chạy trên một Mac sạch không có Homebrew (chỉ kiểm qua DYLD_PRINT_LIBRARIES trên máy dev).
- Ảnh chụp cửa sổ thật gồm cả lớp OpenGL đè lên web (cần quyền Screen Recording).
