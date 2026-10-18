# V2.4 ADDITIVE PRODUCT ARCHITECTURE — Space Planning + Real-Time 3D + Local Renders + Production

## 0. Explicit non-goals
No rebuild/refactor of stable existing CAD engine; no separate shadow floorplan app; no raster disguised as editable CAD; no redesign locked 12 screens; no LLM-generated unverified CNC; no automatic power-up/streaming NC to machinery; no promise of 100% AutoCAD/SketchUp/3ds Max parity without measured tests.

## 1. Canonical semantic document / single source of geometry truth
Extend existing project model with unique IDs and versioned entities, using adapters to avoid incompatible serialization:
- `Site, Level, Room, Wall, Opening, Door, Window, Slab, FloorFinish, Ceiling, Roof, Stair, MEPFixture, Lighting, FurnitureInstance, CabinetAssembly, CabinetPart, Material, CameraBookmark, SectionPlane, SheetDefinition`.
- Separate `Geometry (mm)`, `Appearance`, `FabricationMetadata`, `SourceProvenance / SurveyStatus / Confidence`, `History`, `Dependencies`, `Revision`.
- All dims use canonical internal mm and explicit transform/unit metadata. Distinguish wall internal/external/centerline dimensions. GUID-based references to doors hosted by walls; cabinet parts tied to assemblies, not merely meshes.
- Edits from 2D CAD, property inspector, 3D direct edit, AI command and drawing import must transact through same command bus with undo/redo and validation. Preserve existing command stack; add adapters rather than replace.
- Every change emits granular dependency/dirty events. Updating a wall invalidates corresponding 3D mesh, elevations, sections, dimensions and affected quantities. Updating a cabinet panel invalidates fabrication cut list/nesting/toolpaths/NC; do NOT silently reuse stale manufacturing files.

## 2. Auto Plan / Smart Room (P0)
- Recognize walls/room bounds from native CAD or calibrated image/scan, create topologically closed spaces with height and exterior/interior face. Warn about ambiguous intersections and missing dimensions.
- Structured room templates: rectangle, L, U, round, polygon, arc, corridor, kitchen, bathroom; dimensions set via keyboard; room labels and area auto-updated.
- Place doors/windows using host-wall constraint, opening cuts, hinge/swing and sill; parametric stairs/levels/roof generation, customizable rather than hardcoded.
- Keep accurate room schedule, net/gross area, and clearance checks based on configurable validated standards, never invented universal legal compliance.

## 3. Instant linked 3D (P0)
- Semantic CAD/BIM entities → tessellated 3D meshes through existing geometry engine/renderer. Reuse exact geometry; don't regenerate an unrelated 3D scene with a generative image model.
- Edits 2D → update 3D incremental; edits in 3D → command bus updates semantic 2D (if editable entity). Do not promise arbitrary mesh-to-CAD inverse without explicit supported modeling mode.
- Direct select/edit walls, material sides, furniture, doors/windows in 3D; synchronized selection/project browser/properties.
- Orbit/Pan/Zoom, named Isometric/Top/Front/Side view, room focus, level filters, front-wall transparency, low-wall cut, clipping planes, section box, door open view state, first-person walkthrough.
- Performance: tessellation caching, instancing, LOD for furniture, partial invalidation; allow preview modes low/high, recovery if GPU fails; budget scenes on 16/32GB unified RAM; benchmark rather than promise FPS.

## 4. Interior Smart Furnish & Space Planning (P0)
- Asset catalog with real dimensions and correct origin, category tags, style, parametric resize limits and clearance envelopes.
- Drag/drop/place, auto-align against walls, rotate, move, group, duplicate, replace preserving origin, set elevation, lock.
- Smart suggestions for kitchen work triangle (guidance only), circulation and cabinet face/access clearances; use measurable deterministic constraints.
- AI proposed layouts: multiple **geometry-valid** options scored transparently: usable area, collision-free routes, storage, door clearance, approximate cost; user preview/reject/apply and redo.
- Room finishes and furniture per-part material, grain orientation/UV, physically based materials, real texture tile size; preview connected to same scene.

## 5. Rendering / camera pipeline (P0 visualization, P1 advanced)
- **Fast realtime look** inside current 3D viewport and local **photoreal** background rendering, without Internet or paid credits.
- Lighting presets: Day / Golden / Night, adjustable sun direction, HDRI local assets, light fixtures, exposure, white balance, tone mapping.
- Capture bookmark as `{camera transform, FOV, lens, level/visibility, section state, scene revision, render settings}`. Source object selection from rendered output is not implied.
- **Suggested implementation:** use existing viewport if functional; render final from exported scene with headless Blender (Cycles; Metal GPU on Apple Silicon), EEVEE for faster preview as feasible. Provide independent render process/queue worker, cancel, estimated size, progress, artifacts, local file cache; no UI freeze. Preserve semantic CAD as authoritative.
- Render modes: preview/medium/high/4K as device allows; camera comparison 3D preview vs render, multiple camera queue, panorama later, batch render by material options, render history and before/after slider.
- Optional local image synthesis (diffusion) for style ideation only. Prominently label **Concept AI Render — geometry not guaranteed**; don't feed hallucinated dimensions/material items to BOM/CNC. Model license and availability must be checked.

## 6. Plan/elevation/section/deliverables from same model (P0)
- Auto-generate elevations, sections, wall elevations, room views, door schedules, furniture schedules, labeled plans, area schedules, dimension chains.
- Sheet layouts A4–A0 with real scale, legend, title block, layer/annotation filtering, print-to-scale validations, mm conversion guards. Export DXF/PDF/SVG as applicable and GLB/STEP/IFC only where supported. DWG via verified adapter/post respecting license.
- Export a presentation package and technical package separately; photoreal image is never a substitute for construction drawings.

## 7. AI Autopilot composition (P0)
User intent -> task graph -> input completeness & units -> semantic CAD commands -> local 3D -> layout/material proposals -> validated 2D/3D -> preview -> user approval -> sheet/quantity -> fabrication -> checks. Resume checkpoints and deterministic audit logs. AI suggestions cannot bypass rule engine / permissions.

Sample user request:
“Đây là mặt bằng khảo sát 6x15m, tường ngoài 200mm, trần tầng 1 cao 3.3m. Hãy tạo bản CAD editable, bố trí bếp và phòng khách, dựng 3D, tạo ba phối cảnh, bóc tách hệ tủ bếp MDF 18mm, chuẩn bị chương trình CNC cho máy đã duyệt.”
Required response: open file and measure, ask about unverified dimensions, then produce verified geometries, draft renders and appropriately staged manufacturing artifacts; gate production.

## 8. CNC stays the top production acceptance gate — inherited from v2.3
- Choose machine profile before nesting/CAM; distinguish head/spindle vs blade vs ATC vs drill bank; profile includes verified controller/firmware/post, machine axes, limits, offsets, tool library, hold-down/vacuum/fixturing and job coordinates.
- Cabinet decomposition records: individual board LxWxT (actual measured thickness), grain vector, finished/cut sizes with edging allowances, side(s) banded, joinery drill patterns with reference sides, face orientation, tolerances, unique labels/barcodes, materials/costs.
- Nesting accounts for sheet sizes, grain, blade kerf/tool radius, margins, clamps; multi-tool operation assignment deterministic.
- Toolpaths/profile/pocket/drill/slot, arc/corner strategy, safe Z, feeds/speeds from validated library, tool-change and head offsets, simulator & parser for selected controller, errors block export.
- After design/measurement/material/machine/tool/post change, mark all downstream fabrication as STALE and require recomputation and re-approval.
- Production NC shall remain disabled on UNVERIFIED profiles; machine/operator commissioning, air-cut and first-article QC required. Program must not auto-start CNC.

## 9. Rollout additive milestones
M0 baseline audit, integrity snapshots and delta matrix; M1 linked 2D/3D room prototype; M2 3D editing + library; M3 local rendering queue/camera + section views; M4 layout AI/autopilot; M5 linking cabinet geometry to CNC (existing v2.3 CAM module); M6 round trip + regression + controlled machine commissioning. Do not set fixed completion dates without repository audit and test team constraints.

## 10. Minimum technical proof
- Change 4.200m wall to 4.500m in plan and observe same GUID wall mesh, room area and section update without full scene rebuild; restore Undo.
- Change door width, opening geometry follows; 2D->3D->2D edits share IDs and transaction history.
- Interior catalog chair is 480x520x900mm in semantic data, 3D dims agree, snap and clearance checks work.
- Save render camera, background render, compare true 3D frame/photoreal output, no source geometry mutation.
- Cabinet visual 3D and 15 part BOM lengths match in mm; change cabinet width then demonstrate quantities and NC marked STALE.
- Machine profile UNVERIFIED blocks NC even if user clicks export, no bypass.
