# UI PATCH MAP — ADD FEATURES WITHOUT REDESIGN

Approved base: MD CAD AI STUDIO 12-screen Pixel-Lock package. Existing logo, sidebar/nav, top bar, command line, layout density, graphite/teal palette, status bars and typography are FIXED. This is a function/IA map, **not a new mockup approval**.

## Projects
- New project templates (apartments, houses, one-room, kitchen cabinetry, offices, interior fit-out); preview, size units, level count and asset defaults.
- Source documents and linked CAD/3D/revision, separate presentation vs fabrication output folders.
- `AI Job Queue`: queued / in-progress / needs user / ready for review / failed / archived.

## CAD Tools (existing)
- Add `Trace/Calibrate Image`, `Smart Room` (rectangle, L, U, polygon, round), auto openings, wall thickness and true-scale dimension entry.
- `2D | 3D | Section` coordinated view switch; respect CAD keyboard mode, no overriding AutoCAD `L`, `TR`, etc.
- Side inspector displays semantic properties and survey provenance / measurement confidence.

## BIM / Architecture (existing)
- `Live 3D` button reusing 3D engine, level selector, auto elevations, linked section box, cutaway and low-walls view, room tree.
- Direct-select and edit for floors/walls/openings where engine supports; model edits flow through same command bus.
- Auto floor area and schedule cards. Add electrical symbols in existing MEP or Room Planner where suitable, not a separate rendering-app silo.

## Interior (P0)
- New **Space Planning** subtab using EXISTING Interior AppShell: Smart Room, Furniture Library, Smart Furnish / constraints, Finish Picker.
- `View modes`: 2D Floorplan | 3D Live | Walkthrough | Render | Production; do not replace existing Interior Design workspace tabs or CNC actions.
- Camera bookmarks, cutaway, wall opacity, Day/Golden/Night quick presets. Default 'Standard CAD 3D' uses geometry truth.
- Furniture asset inspector: Width/Depth/Height/Elevation/Material/Grain, Replace in place, clearance warning.
- Production subtab retains machine selection and approved CNC workbench; no direct NC from render.

## AI Intelligence Studio (existing)
- New task presets: 'Ảnh/PDF -> CAD', 'CAD -> 3D', 'Bố trí phòng tự động', '3 phương án nội thất', 'Phối cảnh 4K offline', 'Tạo mặt đứng/mặt cắt', 'Bóc tách và chuẩn bị CNC'.
- Display stages; metrics/uncertainties/required measurements; pre/post action preview; Approve/Reject/Undo; checkpoint/retry.
- Render ideation labelled 'AI Concept, NOT measured geometry'; must not become machine fabrication geometry.

## Renders (existing)
- Hook scene/camera IDs from BIM/Interior/Mechanical models into existing Renders screen.
- Add job queue worker state, quality, aspect ratio, image format; local engine selection, color management; Day/Golden/Night, light and environment.
- Before/after comparison slider and camera sync with live model; local saved outputs, history and versions.
- Do not change current pixel-locked Renders layout without approval; use tabs, drawers, floating popovers as permitted extensions or submit redline for approval.

## Components (existing)
- Parametric asset metadata; real dimension/preview 2D/3D; materials and furniture per-part finish; licensing and asset provenance; linked cabinet hardware models.
- Search from command palette and AI; ensure no model library license violations.

## Settings (existing)
- Configure local render engine (existing viewport/headless Blender), worker path, CPU/GPU, VRAM budget, persistent cache; no cloud keys.
- `Interaction Profiles`: AutoCAD / SketchUp / 3ds Max / MD Space Planning. SpacePlanner keyboard shortcuts are **not** copied as defaults if conflicts with user-selected AutoCAD. Expose customizable mapping; persist per workspace; on-screen cheatsheet.
- `Privacy`: offline mandatory, outbound network disabled by default, logs local, local model registration path, render/texture license report.

## Rule for UI changes
Implement functionality with existing reusable components. If new sections cannot fit without changing pixel-locked layouts, submit `UI_CHANGE_REQUEST` with before/after and wait for approval. Never draw screenshots as interactive UI. Complex preview geometry rendered via CAD/3D engine or approved local assets only.
