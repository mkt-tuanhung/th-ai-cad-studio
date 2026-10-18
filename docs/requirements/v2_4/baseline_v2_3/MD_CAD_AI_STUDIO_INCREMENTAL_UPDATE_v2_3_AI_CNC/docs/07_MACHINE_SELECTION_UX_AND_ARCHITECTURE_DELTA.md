# UI & Architecture Delta — Machine Selection v2.2

## Không làm lại app
Audit `Interior` hiện tại: nếu đã có `Manufacturing`, `ToolLibrary`, `Nesting`, `CAM`, `PostProcessing`, `ExportCenter`, bọc thêm Machine Selection vào luồng hiện có. Không thêm sidebar root mới khi `Interior` đã đủ; thêm tabs/sub-navigation bên trong `Interior`. Mọi file project cũ phải load nguyên trạng.

## Navigation mới (đề xuất chèn vào hiện hữu)
- `Interior > Design` (giữ nguyên)
- `Interior > Manufacturing Hub`: công đoạn đang thực hiện, material/thickness, BOM/cut list revision, summary các blocker
- `Interior > Machine Selection` (mới): danh sách nhà xưởng/máy, lọc 1/2/3 heads, single spindle + ATC, drill bank, saw; ô search; máy được xác minh; nhãn trạng thái, `Capabilities`/`Travel`/`Tools`/`Controller`; nút `Use for this job`.
- `Interior > Cut List`, `Nesting`, `CAM`, `Simulation`, `NC Export` (nối engine đã có)
- `Interior > Machines & Tools`: đăng ký máy, clone template, map head/tool, hiệu chuẩn, kiểm tra chứng nhận post, audit log, import/export cấu hình.

## Machine Selector layout theo pixel lock
Giữ sidebar, topbar, VI/EN, spacing, colors, fonts, MD branding. Content:
1. Header `Chọn máy CNC | Select CNC Machine` + Project/Job breadcrumb.
2. Left/center machine cards/table: `Tên máy`, `nhà sản xuất/model`, `controller/firmware`, `1/2/3 đầu`, `loại đầu`, `bàn máy`, `status`, `last calibration`.
3. Right inspector `Machine Capabilities`: tool heads, working area, accepted material sizes, supported ops, registered tools, zero, safety zones, profile revision, post-processor, verified evidence.
4. Top machine group segmented `1 đầu`, `2 đầu`, `3 đầu`, `ATC`, `Saw/Drill/Hybrid` as **filter**, not actual capability decision.
5. CTA: `Use for this Job` creates selection snapshot; `Edit Profile` requires permission; `Run Compatibility Check` generates blockers for current manufacturing job.
6. Further tabs `Tool / Head Mapping`, `Fixtures & Vacuum`, `Controller & Post`, `Commissioning & QA`, `Production History`.
7. Warning state always visible when `DRAFT / UNVERIFIED`; button `Export Production G-code` disabled with precise blockers.

## Stateful interactions
- Changing machine may preserve `PartModel`, but invalidates nesting/CAM/post/release; shows confirmation preview before replacing work context.
- If switching profile while NC released, old release immutable/auditable, new job revision required.
- Filter `3 heads` still distinguishes independently controllable 3 heads from mechanically offset 3 heads or 3 saws.
- UI never enables an unsupported operation just because the machine has 3 heads.
- Selected model must persist per manufacturing job with exact version/hash.
- Machine config editing/qualification role-restricted; change log mandatory.

## Suggested interfaces, adapt to existing repo
- `IMachineProfileRepository` (migrate/additive, versioned)
- `IMachineCapabilityValidator`
- `IHeadScheduler` (sequential default; parallel disabled)
- `IToolAndHeadCalibrationService`
- `IMachineAwareNestingPlanner`
- `ICamToolpathPlanner` (reused if present)
- `IMachineSpecificPostProcessor` (controller+firmware+model adapter)
- `IProductionReleaseGate`
- `IProductionTraceService`.

## Data migrations
- Existing CAM jobs without selected machine: keep open/editable as `LEGACY_UNASSIGNED`, production export blocked. Do not delete or silently assign generic machine.
- Existing machine profiles: import conservatively, status remains `UNVERIFIED` until evidence, preserve original and audit provenance.
- Existing saved NC files: never retroactively label VERIFIED.
- Feature flags: `interior_factory_enabled` (existing), `cnc_machine_selector_enabled`, `cnc_multihead_planning_enabled`, `cnc_production_release_enabled` (latter OFF by default).

## Performance, OS, localization
- Mac Apple Silicon, no external AI API. UI labels/warnings/logs/help VI/EN; CNC codes and part identifiers stable language-neutral. Test macOS scaling.
- Geometry/CAM and safety checks deterministic, never blocked on local LLM. Multi-thread computational planning must not freeze CAD viewport.
