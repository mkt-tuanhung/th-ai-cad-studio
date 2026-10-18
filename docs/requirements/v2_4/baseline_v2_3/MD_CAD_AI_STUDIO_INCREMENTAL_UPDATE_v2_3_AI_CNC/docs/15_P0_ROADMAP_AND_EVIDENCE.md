# P0 ROADMAP — TỪ V2.2 ĐẾN TỰ ĐỘNG SẢN XUẤT

## Đây là backlog, không phải cam kết tiến độ/thành phẩm đã chạy
1. **Phase 0 / Audit & Baseline**: inspect current repo, tests, pixel-lock regression; status per feature; determine what v2.2 already really implements. Deliver audit, gap, own risk controls.
2. **Phase 1 / CAD Interoperability**: DXF (editable) and image/PDF with calibration, layers/geometry topologies; benchmark real plan. Exports with roundtrip. DWG optional adapter verified.
3. **Phase 2 / Parametric Interior/Architecture**: generated walls/floors/openings + cabinet manufacturing model, document GUID, reversible edits; linked BOM.
4. **Phase 3 / Machine-ready Production Data**: pick exact CNC + 1/2/3 head/ATC/drill/saw, stock actual measured and accessories; auto parts, edge, drills, cut-list, nesting with provenance, labels.
5. **Phase 4 / Deterministic CAM**: profile/pocket/groove/drill/verified saw only; input-to-toolpath and machine controller post; parser, simulation coverage and fail-closed export.
6. **Phase 5 / Machine Commissioning & First Article**: individual machine's controller/firmware verified, calibrated tools & heads, air cut, first material cut, metrology QC/approvals; production release with signed artifacts.
7. **Phase 6 / Autonomous Planning/Recovery**: offline AI task graph, retry, task queue, user approval, confident/out-of-scope detection. Keep human supervision and machine release.

## Demo phải chứng minh end-to-end (không ảnh render làm bằng chứng)
**Case A — Scan floor plan**: import 2D photo showing one 4000 mm reference and independent dimension, calibrate; export editable DXF; compare dimensions; construct 3D 2700 mm walls only after height input is explicitly provided; save and reimport.
**Case B — Existing DXF**: import real DXF with walls/cuts; classify editable elements; create 3D parametric (with level settings approved); edit one wall then update linked views/drawings.
**Case C — Cabinet to CNC**: source dimensions verified; generate cabinet feature tree, door gaps, actual panel thickness, edge map, drilling, canonical cut-list/BOM; choose machine; nest by grain; CAM toolpath; machine-matched NC (NOT FOR MACHINE USE until verified). Engineer compare part dimensions vs NC extents.
**Case D — Production**: physically qualified controller and machine post, first article sample QC, release approvals. Without machine → BLOCKED, cannot be marked PASS.

## Measurable gates
- Survey source / calibration provenance must link to each production-critical dimension; any `UNVERIFIED` dimension blocks manufacturing release.
- Entity DXF editable, vector primitives; sample roundtrip dimensions within task-specific approved tolerance; no silent object loss.
- 2D→3D dimensions consistent; no invalid solids; construction variations propagate to part BOM.
- Every part has stable ID and traceability design→cut list→nest→CAM→NC→label.
- Every machine profile and controller post has version & commissioning reference; capability/readback checks pass.
- 0 unreviewed operation unsupported by selected machine; 0 collision in validated simulation; bounding boxes within work envelope and clamp restrictions.
- NC release must refuse (tests) on stale measurements, changed machine, unverified post, missing fixture, missing operator signoff, raw AI NC.
- Tests must run under aarch64 macOS and on actual test fixtures; no fabricated screenshots/test status.

## Manual CAD/SketchUp/3ds Max parity remains mandatory backlog
Do not delete manual tools, shortcuts or menus; establish version baseline and complete inventory through separate parity matrix. Cannot declare 100% based on these pipeline tests or limited number of aliases. Parallel effort, not substitute for P0 end-to-end case.
