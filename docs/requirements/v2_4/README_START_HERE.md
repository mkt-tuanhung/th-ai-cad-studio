# MD CAD AI STUDIO — V2.4 CUMULATIVE UPDATE (SPACE PLANNING + RENDER + CNC)

**STATUS: REQUIREMENTS / CHANGE REQUEST, NOT EXECUTABLE APPLICATION.** Prepared 2026-10-18.

This is one consolidated update package on top of the **existing Claude repository**. It includes the complete v2.3 requirements package in `baseline_v2_3/` plus all v2.4 SpacePlanner-inspired enhancements. The prior v2.3 file is not lost or superseded functionally.

## START ORDER
1. `docs/00_CLAUDE_START_HERE_UPDATE_ONLY.md` — paste this to Claude.
2. `docs/01_RESEARCH_REPORT_SPACEPLANNER.md` — evidence, differences, and limitations of reference website.
3. `docs/02_V2_4_PRODUCT_ARCHITECTURE_DELTA.md` — 2D/3D unified document, real-time views, render, AI, and CNC invariants.
4. `docs/03_UX_INTEGRATION_MAP.md` — additive UI under approved MD CAD AI STUDIO visual lock.
5. `docs/04_LOCAL_TOOLS_LICENSES_AND_DEPLOYMENT.md` — local-first tools and release/license cautions.
6. `qa/FEATURE_CROSSWALK_V2_4.csv` — prioritized feature audit matrix (must not mark implemented absent code/tests).
7. `qa/ACCEPTANCE_TESTS_V2_4.csv` — executable acceptance scenarios to implement, not test results.
8. `baseline_v2_3/MD_CAD_AI_STUDIO_INCREMENTAL_UPDATE_v2_3_AI_CNC/00_READ_THIS_FIRST_v2_3.md` and all v2.3/CNC docs.

## LOCKED PRINCIPLES
- **UPDATE IN PLACE, NO REBUILD:** Audit repo and form a delta; preserve existing engines, modules, presets, user data and 12-screen pixel-locked MD UI. No new repo/framework without approval.
- Primary value: AI self-directed design, BIM/interior, image/PDF->editable CAD->parametric 3D->BOQ/Cut List/Nesting->CNC CAM production.
- **Interior and construction P0; Civil later.** Manual AutoCAD/SketchUp/3ds Max compatibility remains targeted, with command-by-command validation, not unearned claims.
- **Offline AI and rendering preferred**, on Apple Silicon; no mandatory paid API/cloud.
- **Geometry truth is not the render:** CAD semantic mm-scale model is the source of truth, photos are presentation artifacts.
- **CNC safety:** image-only/estimated measurements never flow into production; choose/verify machine/controller/post/tool/fixtures, validate toolpaths, air-cut/first-article and operator approval before production release. Never command a physical CNC machine to auto-start.
- Bilingual VI/EN; app name **MD CAD AI STUDIO**; credit **Xây dựng và phát triển bởi Minh Dũng** wherever already required.

## RESEARCH CAUTION
SpacePlanner site homepage advertises photo/PDF AI rebuilding. The currently published import docs specifically say `Rebuild with AI` is **paused** and image-underlay accepts PNG/JPG, not PDF/DWG. Do not describe that capability as publicly verified functional.
SpacePlanner's realistic render is **credit-based**. We are describing inspiration and independently implementing features, NOT scraping or copying proprietary source, assets, interface, branding or services.

## HANDOFF EVIDENCE REQUIRED
Claude must deliver code diffs, test scripts/results, screenshots compared to approved mockups, sample semantic CAD geometry, 2D/3D synchronization recordings, local Blender render test, round-trip exports, and **CNC release gate remains locked absent verified machine profile & physical tests**.
