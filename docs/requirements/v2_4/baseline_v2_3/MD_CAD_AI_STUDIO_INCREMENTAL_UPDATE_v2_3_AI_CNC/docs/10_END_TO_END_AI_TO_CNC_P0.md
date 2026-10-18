# P0 — AUTONOMOUS INTERIOR PRODUCTION PIPELINE (THI CÔNG THẬT)

## Product definition / Promise
**Một câu lệnh + số đo hiện trường → tự thiết kế/tạo 3D + chuẩn bị bộ hồ sơ gia công có thể dùng để sản xuất sau khi kỹ sư duyệt và máy được nghiệm thu.** Từ ngữ "tự cắt" trong marketing phải giải thích rõ: AI tự **chuẩn bị cut job, nesting, CAM, NC**; **vận hành máy thực tế** chỉ bởi người có thẩm quyền, có biện pháp an toàn vật lý, không tự start. Đặc tả này không chứng nhận một mẫu máy cụ thể.

## Hai pipelines có thể song hành
A. `Image/PDF → calibrated CAD vector → interpreted architectural objects → parametric 3D → cabinet templates → manufacturing parts`.
B. `Existing DXF/DWG/IFC → units/geometry/semantics audit → parametric 3D → cabinets/fitout → manufacturing parts`.
Cả hai đi chung `Part Master → machine selected → Nest → CAM → Controller Post → NC Backplot/Simulation → commissioning/signoff → Production Pack`.

## Phân tách đúng trách nhiệm kỹ thuật
- **AI Planner (local LLM)**: hiểu tiếng Việt/Anh, lập task graph, phân vai; hỏi lại khi cần, gợi ý thiết kế và sửa lỗi. Chỉ phát **typed intents**, không ghi NC.
- **Vision & semantic analyzer (local)**: OCR kích thước, nhận tường/cửa/vật liệu/các đối tượng hình học, scoring nguồn đo. Xuất candidates có confidence.
- **CAD Engine (native deterministic)**: vector/entities, scale, topology, dimensions, snap, solids, geometry validations.
- **Parametric Building/Interior**: walls/slabs/levels + cabinet part model + BOM relations, changelog.
- **Manufacturing Planner**: BOM/cut list, grain orientation, edges A/B/C/D, drilled face & coordinates, hardware model/spec, allowances/fit rules (approved).
- **Nesting Engine**: sheet size, actual thickness, usable area, fixture/vacuum, grain/face locked, saw kerf vs router kerf, cut order, labels.
- **CAM kernel**: milling/drilling/saw operations, inside/outside contour, offsets, tabs, lead-ins, corner strategy, safe Z, tool assignment and feed/speed APPROVED by shop.
- **Verified machine postprocessor**: deterministic translate of intermediate representation into dialect accepted by exact controller/firmware/head mapping.
- **NC Interpreter + backplot**: read actual emitted file with modal state, check motion range, tools, work zero, units, absolute/incremental, safe retract, fixture collisions within fidelity of model. Complement with controller simulation; not substitute machine physical check.
- **Machine controller**: out-of-scope for autonomous unattended movement; manual machine start/approval.

## Technical data contracts
`SurveyEvidence` includes measurement id, method, timestamp, source pixel/filename or laser measure, reference distance, scale calibration transform, confidence, reviewer status, real-site notes.
`PartMaster` has `part_id`, revision, source object GUID, assembly path, L/W/T nominal & material lot actual thickness, units mm, grain axis, finished dimension vs rough-size, edge banding per side, through and blind holes in local part frame, face orientation, tolerance approved, hardware list, finish.
`MachineSetup` has verified machine id/revision, controller/firmware, travel limits, spindle/saw head IDs, tool list + calibration offsets and dates, bed, hold-down regions, origin, work coordinate system, approved materials feeds/speeds.
`ManufacturingJob` references hashes of SurveyEvidence, PartMaster, stock, machine, tool offsets, nesting, NC, postprocessor, QC signoff. Any change invalidates dependent derivative states.
`NCRelease` is immutable approved artifact with part/sheet association, postprocessor version, checksum, checks, signed approval, machine and tool revision and only allowed when ALL release conditions true.

## Bóc tách tủ chuẩn
- Tủ bếp trên/dưới, tủ áo, kệ, tủ lavabo, vách, bàn và hệ custom parametric.
- Quy tắc kết cấu phủ/lọt, hậu lọt/hậu phủ, chân đế, nẹp che, khe cánh, đường vân, mặt A/B, tolerance và lắp đặt theo template được duyệt.
- Phân biệt `finished L/W` với `pre-edge banded blank L/W`. Không tự cộng/trừ sai khi hai cạnh cùng dán.
- Tự trích BOM cấu kiện, phụ kiện, vật tư, cánh/đợt/hậu/hông; tạo mã QR/tem tấm, file lắp, mặt khoan.
- Đầu vào thiếu độ dày thực tế, bản lề/runner SKU, hướng mở cánh, khe chừa, thông số dao → `NEEDS_MEASUREMENT` hoặc `NEEDS_ENGINEER_APPROVAL`, không ngầm đoán.

## Machine-aware CNC chính là phần P0
- Select `workshop → machine make/model/controller/firmware/profile → head capabilities (1/2/3 spindle OR 1/2/3 saw, drill bank, ATC) → tools → stock` **trước** nesting/CAM.
- Ván ngang/vân đứng, khổ hữu dụng, kẹp/giác hút, phân công đầu 1/2/3, offset từng đầu, reach, giới hạn tốc độ, cấp độ rung, thay dao được xác minh.
- Nếu đầu/máy không có khả năng gia công yêu cầu, tách sang `SECOND_MACHINE_OPERATION` hoặc báo unsupported; **không tạo NC giả**.
- Khi đổi máy/revision post/tool/zero/stock/part → invalidate nest/toolpath/file/approval; bắt regenerate và revalidate.

## Phải có trạng thái rõ ràng
`DRAFT → MEASUREMENT_REVIEW → CAD_VERIFIED → MODEL_VERIFIED → PARTS_APPROVED → MACHINE_SELECTED → NEST_VALIDATED → CAM_VALIDATED → POST_GENERATED → NC_PARSED_AND_SIMULATED → MACHINE_COMMISSIONING_REQUIRED → HUMAN_SIGNED → PRODUCTION_RELEASED`.
Một trạng thái chỉ sang bước kế khi đã pass validation; không nhảy qua trạng thái bằng UI/CLI/API. Machine commissioning có thể reuse chứng nhận còn hiệu lực của **cùng máy và setup tương đương**, nhưng first-article QC từng vật liệu/job vẫn do quy trình xưởng quyết định.

### Production release gate: mandatory
- Survey geometry/dimensions confirmed; part revisions and units confirmed.
- Machine/profile + controller/firmware, post, offsets, fixture model and tools VERIFIED and matching; machine capability supports operation.
- Nest/cut order checked incl. grain and clamps; tool lengths/diameters measured; safe Z and work zero confirmed.
- NC exactly re-parsed/backplotted; bounding box, modal commands, clamps and stock removal simulation pass within validated coverage.
- Local engineer/operator sign-off with IDs/time/revisions; preflight at machine, first-article cut + dimensional QC per machine/workshop policy.
- **No direct AI-run machine, no E-stop bypass, no automatic DNC/streaming without separate safety design/review.**

## Evidence deliverables required from Claude
- Import real files and export **editable DXF** with verified dimensions, not screenshot; geometry count and layers report.
- Model generated as solid/parametric assembly: sample cabinet 800 × 600 × 720mm design parameters (illustrative only), part count and cut list; assert numeric invariant tests.
- Comparison drawing 2D ↔ 3D ↔ BOM ↔ CAM: same Part GUID/revision and mm coordinates. BOM totals and edge consistency.
- 1-head/2-head/3-head machine variation tests with fail-closed cases, verified vs unverified no release.
- Signed-off validated machine-specific demo **only if a real machine, true controller, measured tools, post are available**; otherwise mark BLOCKED/UNVERIFIED clearly. Export DXF/PDF/cut-list may still work when NC locked.
- Test logs, sample data, source paths, screenshots/recordings with counts and numeric invariants, source changed (not new repo), versioned rollback.

## Nghiệm thu tại xưởng (do xưởng định nghĩa)
Dimension deviation, squareness, hole offsets/depth, edge finish, assembly fit, chip-out, repeatability; range of tolerated deviation must be approved by authorized production engineer and based on machine/material (không bịa tolerance toàn cục). Phải có dry run/air cut, mẫu đầu tiên, đo QC; camera/AI không thay được đồng hồ đo hoặc ký duyệt.
