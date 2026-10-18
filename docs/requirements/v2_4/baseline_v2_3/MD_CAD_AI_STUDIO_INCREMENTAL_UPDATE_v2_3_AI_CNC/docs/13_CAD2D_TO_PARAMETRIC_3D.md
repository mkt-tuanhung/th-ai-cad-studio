# CAD 2D → SOLID / PARAMETRIC 3D — INTERIOR & ARCHITECTURE

## Mục tiêu
Import file DWG/DXF architectural plan hoặc CAD 2D vector đã xác minh → auto model walls, columns, beams/slabs, doors/windows, stairs, rooms/floors, interior cabinetry/furniture, và xuất solid/STEP/IFC/GLB theo chức năng thực. Không chỉ extrude tất cả đường 2D.

## Pipeline
1. Read DXF/DWG via licensed adapter; units INSUNITS/reference project config; warn units absent, zero extents, XREF missing, bad block transforms.
2. Geometry normalize: arcs, splines tessellation policy, polylines, blocks, layer/entity inheritance, dimension associations.
3. Build constraint/semantic graph: detect closed footprints, parallel wall faces, wall centerlines, openings, stairs, annotations and furniture; classify unknown and confidence.
4. Floor levels from 2D plan set + project metadata; identify structural vs nonstructural, layer rules per template; no unsupported height guesses.
5. Extrude as parametric **B-Rep or BIM entities**, stable GUIDs and relations for wall/opening/slab/door/roof. Create model tree and editable parameters.
6. Generate room surfaces and views, material flags and basic consistency checks; keep design dimensions canonical mm.
7. Preview side-by-side 2D/3D, inspect model for overlaps/voids/invalid solids, dimensions/range, missing layers and semantic ambiguity.
8. User approval → save document revision → export STEP/IFC/GLB; preserve param edits and regen capability.

## Interior conversion
- Convert room envelope to layout objects; model cabinetry from feature-based joinery templates, not generic visual boxes.
- Each part has thickness actual, left/right/top/bottom panel role, cutting size/finish size, edge tape, grain, local CNC face/orientation and hardware drilling. Any geometry edited affects BOM & manufacturing tree.
- Nonmanufacturable decorative meshes/assets tagged REFERENCE_ONLY and cannot become CNC toolpaths without parametric/surface reconstruction.

## Hard blockers
- Overlapping/noisy 2D lines, open polygons, missing floor height, incomplete dimension, different floor coordinate systems.
- DWG entities/XREF/3D proxies unsupported → show review tasks not silent omission.
- For thin/nonprismatic objects support manual modeling; if unsure, retain editable 2D and queue user review.

## QA examples
- 1000mm line reimports at 1000mm, orthogonal wall length/width correct with height confirmed, openings cut correctly, 3D mass closes, object IDs stable; roundtrip not drop entities silently.
- Edit 2D wall length → 3D connected geometry updates and cabinet fit clashes regenerate; BOM/job downstream stale on changes.
- Imported drawing in inches uses correct conversion to mm; no automatic scale using view zoom.
