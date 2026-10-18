# CLAUDE — EXECUTE INCREMENTAL V2.4 ON EXISTING MD CAD AI STUDIO REPO

You are upgrading an **already substantially implemented** MD CAD AI STUDIO. This ZIP is NOT a starter repo and is NOT permission to rebuild, rebrand, recreate mockups, delete modules, migrate frameworks, or change foundational engines unnecessarily.

## Read order
1. `README_START_HERE.md`.
2. `docs/01_RESEARCH_REPORT_SPACEPLANNER.md` (verified, proposed, and contradictory marketing claims).
3. `docs/02_V2_4_PRODUCT_ARCHITECTURE_DELTA.md`.
4. `docs/03_UX_INTEGRATION_MAP.md`.
5. `docs/04_LOCAL_TOOLS_LICENSES_AND_DEPLOYMENT.md`.
6. `qa/FEATURE_CROSSWALK_V2_4.csv`, `qa/ACCEPTANCE_TESTS_V2_4.csv`.
7. All inherited v2.3 documents, tests, UI demo and schemas inside `baseline_v2_3/MD_CAD_AI_STUDIO_INCREMENTAL_UPDATE_v2_3_AI_CNC/`.

## FIRST — INVENTORY AND BASELINE
- Identify current git repo, branch, build command, CAD kernel, editor, model, existing image recognition, AI local stack, renderer, render queue, export and CNC postprocessor implementation.
- Before edits, create source backup/branch/tag and run existing tests; do not overwrite/delete user work. Output gap matrix with `Implemented + Verified / Implemented Untested / Partial / Missing / Blocked` with precise source references.
- Assess screenshot fidelity to *approved* MD CAD AI STUDIO 12-screen mockups, keeping AppShell unchanged.
- Describe Architecture Delta with minimal touch points, feature flags, migration strategy (only if schema change needed), rollback and regression checks.

## ADDITIVE FEATURE SET (DON'T REWRITE EXISTING)
A. Space Planning parametric room geometry and catalog, snap/dimensions/materials.
B. One semantic 2D CAD/3D/BIM model updated incrementally (not disconnected images). Synchronize edits, selection, history, and drawings.
C. Live 3D cutaway/walkthrough/sections/levels, 3D furniture and materials.
D. Local render engine + cameras/Day/Golden/Night, realistic image output, queue/history, comparing real viewport to images, no paid cloud credits.
E. Smart AI task presets: image/PDF -> calibrated CAD; CAD -> parametric 3D; multiple interior options; automatic plan/elevations/sections/sheets; link proposed cabinets to real manufacturing decomposition.
F. Preserve P0 CNC: select exact machine before nesting/post; 1/2/3 heads differentiated from saw blades and ATC; verified controller/post, tooling/offset/fixtures. Producing a pretty image NEVER counts as valid geometry or machine code.
G. VI/EN everywhere, keyboard compatibility profiles; no keys hijacked from AutoCAD/SketchUp/3ds Max mode.

## MANDATORY QUALITY GATES
1. 2D and 3D edit same data and maintain mm dimensions and GUIDs. A 2D wall change updates 3D/elevation/area without full rebuild; undo does exactly one grouped operation.
2. A photoreal AI image is marked 'presentation only' and never used as the source of dimensional truth/CNC geometry.
3. Importing an image with no known dimension produces REVIEW REQUIRED, not made-up real dimensions; PDF with OCR confidence threshold must be confirmed for fabrication.
4. All manufacturing changes invalidate dependent Cut List/Nesting/CAM/NC and require review.
5. MACHINE PROFILE UNVERIFIED => prohibit production NC; simulation, controller parser, postprocessor tests, operator approved machine tests and first-article QC required. NEVER auto-start physical CNC equipment.
6. QA automated tests as specified in `qa/ACCEPTANCE_TESTS_V2_4.csv`, plus inherited v2.3 QA (none may be reported passed until executed).
7. Tested Mac Apple Silicon offline; no externally hosted inference or fees, and no upload of customer drawings.
8. Existing 12-screen Pixel-Lock UI stays; seek owner approval for material layout changes.

## DELIVERY CONTRACT
- Changes as patch in the **existing repository only**.
- Audit report & delta table before code; implementation phase-by-phase with commit IDs, changed files, screenshots, demo videos, linked CAD samples, local render comparison, proof of exports and CNC simulation logs.
- Report status separately for each task: Proposed / Implemented / Tested / Failed / Blocked; don't inflate counts.
- First working vertical slice: a measured 2D furnished room -> 3D live -> materials -> one saved camera -> local high-quality render -> editable plan PDF/DXF -> cabinet sample cut list **with CNC output disabled until commissioned**.

**DO NOT rebuild. DO NOT clone SpacePlanner branding/site code. DO NOT replace actual CAD/3D/CNC with static screenshots. Implement professionally and safely.**
