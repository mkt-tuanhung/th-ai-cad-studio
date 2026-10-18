# CLAUDE — UPDATE ONLY / KHÔNG REBUILD — MD CAD AI STUDIO v2.1

> TÀI LIỆU CÓ QUYỀN ƯU TIÊN CAO NHẤT trong gói nâng cấp chiến lược này. Đây là UPDATE IN-PLACE của source code hiện tại đã được lập trình gần hoàn thiện. **KHÔNG xây dựng dự án mới. KHÔNG viết lại toàn bộ. KHÔNG tạo repo mới. KHÔNG xóa tính năng đã có.**

## Mệnh lệnh mở đầu

Claude, chủ dự án xác nhận **MD CAD AI STUDIO hiện đã được bạn phát triển gần hoàn thiện ở phiên bản trước**. Mọi yêu cầu mới về AI tự chủ, tính năng CAD/3D thủ công, nội thất và xây dựng là **CHANGE REQUEST / FEATURE ENHANCEMENT** trên **chính codebase hiện hữu**. Các tài liệu v2.0 là tiêu chí mục tiêu, tuyệt đối không phải mệnh lệnh khởi tạo lại ứng dụng.

### 0) Những việc CẤM
- Không dùng `create project`, scaffold một app khác, chuyển framework, thay engine, rewrite module hàng loạt hoặc thay AppShell khi chưa được chủ dự án phê duyệt cụ thể.
- Không xóa/đổi tên schema, database, asset, models, thư viện component, config, preset, hệ lệnh, macro, keyboard mapping hiện hữu chỉ vì bản spec mới.
- Không cắt bỏ chức năng đã có dù đó là module chưa thuộc ưu tiên P0; giữ nguyên, có thể tạm ẩn khỏi roadmap nhưng không hủy code/dữ liệu.
- Không tự sửa lại giao diện mockup đã duyệt (12 màn + brand MD). Không dùng lại mockup toàn màn làm app tương tác.
- Không tuyên bố "đã đạt 100% AutoCAD/SketchUp/3ds Max" chỉ dựa trên số lượng lệnh hoặc button; chỉ báo phần đã kiểm thử.
- Không gọi AI Cloud/API trả phí; ưu tiên local model và tính năng offline đã thống nhất.

### 1) BẮT ĐẦU BẰNG AUDIT REPO THỰC TẾ — CHƯA CODE MỚI
1. Xác định **root repo hiện hữu** người dùng đang làm với bạn; ghi lại framework, modules, apps, dependency, migrations, version, AI engine và CAD/3D engine **đang thật sự được sử dụng**. Nếu không tìm thấy repo, hỏi đường dẫn — **không tạo project mới**.
2. Tạo Git checkpoint/branch `feat/autonomous-design-update` từ trạng thái hiện tại. Nếu repo có thay đổi chưa commit, **không tự discard/stash ghi đè**; báo trạng thái và xin phép trước thao tác rủi ro. Sao lưu an toàn cấu hình và dữ liệu thử nghiệm nếu cần.
3. Thực thi test hiện có và chụp baseline 12 màn pixel-lock, lưu logs. Nếu test fail trước khi sửa, ghi rõ baseline failure.
4. Lập `docs/UPDATE_GAP_AUDIT.md` với 4 cột **EXISTING + TESTED / EXISTING + INCOMPLETE / UI-ONLY / NOT IMPLEMENTED** cho từng tính năng AI, CAD2D, 3D, BIM, interior, CNC, Projects, Settings, Components, i18n, branding; ghi tên file/module cụ thể.
5. Lập `docs/ARCHITECTURE_DELTA.md`: **GIỮ NGUYÊN / MỞ RỘNG / THÊM MỚI / CẦN SỬA (kèm lý do)**, chọn vị trí hook/integration trong kiến trúc hiện có. Ưu tiên sửa nhỏ, backward-compatible.

### 2) KẾ HOẠCH NÂNG CẤP CHỈ CÓ DELTA
- **P0**: kết nối UI & CAD/3D/BIM hiện có với autonomous task orchestration thật; một prompt tự làm nhiều bước theo typed commands, có job queue, checkpoint, geometry validation, human review, resume. Tái sử dụng mọi engine và model local sẵn có nếu phù hợp.
- **P0**: hoàn thiện luồng Nội thất và Xây dựng thực tế; cập nhật cut list, BOM, nesting, CAM/machine gate nếu code cũ thiếu. KHÔNG để LLM tự sinh NC/G-code sẵn để chạy máy.
- **P0**: lập `MANUAL_COMPATIBILITY_GAPS.csv` từ lệnh/shortcut đang chạy và kiểm chứng. Chỉ triển khai công cụ/phím tắt còn thiếu hoặc lỗi, theo 3 compatibility profiles (AutoCAD / SketchUp / 3ds Max) và cấu hình macOS. Không viết lại input/command system đang chạy tốt.
- **P1**: mở rộng MEP và nâng cao 3D trong engine hiện hữu.
- **DEFER**: Civil/Thủy lợi; không xóa module Civil đã có.

### 3) HỢP ĐỒNG TƯƠNG THÍCH NGƯỢC
- Giữ format dự án hiện tại; mọi migration phải có khả năng kiểm tra trên bản sao và rollback. Không tự động chuyển đổi dữ liệu người dùng thật khi chưa xác nhận.
- Giữ routes, file paths public, action IDs, command aliases, shortcuts, cấu hình model AI và export APIs nếu chúng đã được sử dụng; những thay đổi không tương thích phải có adapter và migration plan.
- Thêm feature flags `autopilot_enabled`, `interior_factory_enabled`, `manual_parity_profile_enabled` để rollout từng phần; khi tắt cờ, ứng dụng phải hoạt động giống bản baseline.
- Bất kỳ engine mới nào cần chứng minh phần hiện tại không hỗ trợ và được duyệt trước khi thay thế.

### 4) KIỂM THỬ TRƯỚC KHI BÁO HOÀN THÀNH
- `baseline UI 12 màn`, kiểm thử song ngữ VI/EN, branding MD, app launch / installer credits.
- Load/save/undo/redo/layer/measure, macro & shortcut cũ, import/export files.
- Autopilot end-to-end với 1 case nội thất và 1 case xây dựng; xuất file có thể mở và sửa tiếp bằng công cụ thủ công.
- CNC: máy thật chưa được khai báo + xác nhận thì không xuất NC chạy sản xuất.
- Test trường hợp tính năng mới tắt (rollback bằng feature flag) mà phần mềm cũ vẫn chạy.
- Sau mỗi milestone, xuất báo cáo **trước/sau**, file thay đổi, test pass/fail, ảnh và limitations.

### 5) THỨ TỰ TRẢ LỜI CHỦ DỰ ÁN
1. `ĐÂY LÀ UPDATE TRÊN REPO CŨ, KHÔNG REBUILD`.
2. `Repo hiện tại: ...` (đường dẫn thực tế và branch).
3. Bảng audit: đã có / thiếu / chỉ UI / đang lỗi.
4. Delta patch được đề xuất, số file tác động, rủi ro và rollback.
5. Bắt đầu code milestone đầu tiên **trên chính repo cũ**, giữ nguyên mọi chức năng đã tốt; báo bằng chứng sau khi test.

**HỆ QUY CHIẾU:** `docs/01_PRODUCT_VISION_AND_PRIORITY_LOCK.md`, `docs/02_MANUAL_PARITY_MASTER_REQUIREMENTS.md`, `docs/03_AUTONOMOUS_DESIGN_FACTORY_ARCHITECTURE.md`, `docs/04_CLAUDE_NEW_MANDATE.md`. Nếu các tài liệu kia dùng chữ “hãy tạo/xây dựng”, hiểu là **bổ sung vào repo cũ sau audit**, không khởi tạo sản phẩm mới.


## BỔ SUNG P0 v2.2 — CNC MACHINING REAL-WORLD / MACHINE SELECTION (ƯU TIÊN CAO HƠN BẢN SPEC CŨ KHI XUNG ĐỘT)
- Đọc thêm `docs/08_CLAUDE_CNC_UPDATE_ONLY_MANDATE.md` và `docs/06_CNC_MACHINE_AWARE_MANUFACTURING_MASTER_SPEC.md`. Đây là PATCH trong repo đang hoạt động, **KHÔNG REBUILD**.
- Máy CNC 1/2/3 đầu gia công, spindle khác ATC, đầu cưa khác dao phay. Bắt buộc chọn machine profile trước nesting/CAM, tính head/tool offsets và postprocessor theo machine/controller/firmware cụ thể.
- Không có **máy thật + profile verified + post verified + air-cut + first article đo thật + operator/engineering sign-off** thì không phát hành G-code chạy máy. Không được lách bằng đường export API/CLI.
- Thứ tự dữ liệu: part chuẩn → machine selection → machine-aware nesting/toolpath → validation → NC release. Giữ manual CAD/BIM/UI/i18n/MD branding như cũ.
- Mọi machine example trong gói là `DRAFT/UNVERIFIED` phục vụ đặc tả, không có feed/RPM, không có G-code production.
