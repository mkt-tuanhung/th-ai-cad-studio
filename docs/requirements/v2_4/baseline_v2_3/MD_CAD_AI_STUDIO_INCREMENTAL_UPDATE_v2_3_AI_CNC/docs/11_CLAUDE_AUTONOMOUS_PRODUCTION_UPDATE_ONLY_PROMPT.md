# START HERE — GỬI CHO CLAUDE TRÊN MAC CỦA ANH

Bạn đang làm việc trên **repository MD CAD AI STUDIO đã code gần hoàn thiện**. Đây là **CHANGE REQUEST v2.3 — UPDATE-IN-PLACE**, KHÔNG PHẢI DỰ ÁN MỚI. Mục tiêu tăng cường AI tự chủ, thêm Image/PDF → CAD editable, CAD2D → Parametric3D, và **P0 quan trọng nhất: tự bóc tách nội thất → nesting theo máy → CAM → G-code đúng controller và quy trình nghiệm thu tại xưởng**.

## 0. CẤM
- CẤM tạo repository/app khác, rewrite engine/framework, vẽ lại AppShell/mokcup MD, thay tên brand/intro, xóa dữ liệu hoặc lược bỏ module đang hoạt động.
- CẤM chỉ tạo màn hình demo, CSV giả hoặc G-code trưng bày rồi coi là đã xong; không thay thế hình học bằng hình bitmap.
- CẤM cho LLM viết trực tiếp G/M-code production, tự đặt chế độ cắt/tool/zero/offset hoặc tự chạy CNC không người xác nhận.
- CẤM đánh dấu "full AutoCAD/SketchUp/3ds Max 100%" khi chưa có kiểm kê và kiểm thử từng tính năng/phím tắt theo version; không bỏ manual tools hiện có.

## 1. AUDIT HIỆN TRẠNG TRƯỚC KHI CODE
- Mở đúng repo cũ, chụp status git, tạo branch nâng cấp và baseline kiểm thử (không reset dirty changes, backup data có kiểm soát).
- Quét module import, OCR/vision, DXF/DWG, 2D topology, BIM solids, cabinet templates, manufacturing BOM, nesting, machine profiles, CAM, postprocessor, NC parser/simulator, CNC release, Local AI, VI/EN.
- Với mỗi chức năng, phân loại **WORKING / PARTIAL / UI_ONLY / MISSING / BLOCKED_BY_MACHINE** kèm file path/test evidence và số lượng test pass/fail. Viết `docs/V23_EXISTING_CODE_AUDIT.md` và `docs/V23_MINIMAL_DELTA_PLAN.md`. Không làm lại module đã WORKING.

## 2. TRIỂN KHAI KHI CẦN, ƯU TIÊN THEO BLOCKER
(A) Survey Intake + Vision: PNG/JPG/PDF/DXF/DWG; OCR kích thước, đo thước tham chiếu, transform pixel→mm, nhận tường/cửa, confidence/source trace. Thiếu mốc đo → yêu cầu xác nhận; không giả mm.
(B) Editable CAD vector: native LINE, ARC, POLYLINE, BLOCK, DIM, layers, object semantics, snap, topology, closed rings, DIM references; xuất DXF vector thực và round trip; adapter DWG chỉ khi đã chứng minh license/compatibility.
(C) Parametric 3D: từ DXF/2D dựng wall, door, windows, slabs, level/room; tủ nội thất phải có solid/feature tree, L/W/T, vật liệu, hardware, liên kết 2D-3D và cập nhật tự động hai chiều có kiểm soát.
(D) **Interior Production & CNC**: chọn đúng máy 1/2/3 đầu/phân biệt saw/router/ATC, measured stock/tools, auto parts/cut list/edge/drill, grain-safe nesting, deterministic CAM, verified controller post, NC re-parser + simulation, setup sheet, human signoff. Mọi NC chưa xác minh = NOT FOR MACHINE USE. Không stream/run CNC tự động.
(E) AI Autopilot: typed tool calls + task DAG + approvals + retries & resume + audit trail, chạy local trên Apple Silicon, xử lý tiếng Việt/Anh; ưu tiên thiết kế tủ, kiến trúc/xây dựng trước Civil.

## 3. TUÂN THỦ AN TOÀN VÀ KỸ THUẬT
- Trước CAM phải có machine profile thực, head/tool offsets và model controller/firmware. Đổi bất kỳ vật tư, tool, geometry, post, machine => `STALE` và regenerate.
- Engine tính toán, không dùng LLM tính nội suy đường chạy dao. Machine commissioning + operator signoff bắt buộc để phát hành NC dùng sản xuất. QC nghiệm thu mẫu đầu tiên theo hồ sơ xưởng.
- Nền tảng AI local hoàn toàn offline không API Key; dependency ưu tiên miễn phí nhưng audit LGPL/GPL và tuân thủ giấy phép phân phối.

## 4. KIỂM THỬ BẮT BUỘC
Đọc `qa/AI_TO_CAD_TO_CNC_ACCEPTANCE_v2_3.csv` và các test hiện có V2.2. Chạy regression toàn phần; chứng minh: ảnh có mốc → DXF editable đúng scale; DXF đã có tường → 3D khớp; bản vẽ/cabinet → số tấm và tọa độ lỗ nhất quán; ba cấu hình máy → NC production bị khóa khi unverified; verified machine post được parser đúng; không đổi UI đã duyệt.

## 5. OUTPUT SAU MỖI PHASE
- Danh sách file đã sửa / file giữ nguyên, kết quả test, ảnh/video, bản vẽ DXF đầu ra, solid 3D/IFC/STEP, cut list, machine-aware CAM preview, NC backplot và blocker thực tế.
- Không tự tuyên bố hoàn thành trong khi chưa chứng minh chạy được với file người dùng và máy thật.

**BẮT ĐẦU NGAY BẰNG AUDIT SOURCE CODE CŨ; SAU ĐÓ CHỈ PATCH PHẦN THIẾU. KHÔNG REBUILD.**
