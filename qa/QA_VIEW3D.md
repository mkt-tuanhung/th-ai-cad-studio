# QA — 3D view side tools (Interior, MEP, Mechanical, BIM)

Desktop app, live OCCT scenes. Script: `native/app/resources/e2e_view3d.js`

```
THCAD_QA=1 THCAD_UI_URL=http://127.0.0.1:5173/ THCAD_SCRIPT=…/e2e_view3d.js THCAD_DOWNLOAD_DIR=<dir> "TH AI CAD Studio.app/Contents/MacOS/TH AI CAD Studio"
```

Result 2026-10-12: **23/23 PASS** (plus `e2e_bim3d.js` OK, self-test OK, 12 browser smoke suites green).

| Tool | How it works | Checked |
|---|---|---|
| Isolate / Show all | native erase of every item not kept; erased items are not picked | Interior (picked dining room + walls = 2 shown), MEP (no selection → the 10 clashing elements), Mechanical (casing), BIM (W1) |
| Hide / Remove from view | native erase of the selection; chip "n hidden · Show all" | MEP SA-01-L2, Mechanical casing (BOM stays 24) |
| Section box | 6 `Graphic3d_ClipPlane`s with capping around the selection (15 % margin); picks ignore cut-away hits | Interior dining room, MEP clashes |
| BIM "3D - Section View" | the building cut 1.5 m above the current level (dollhouse of that floor); "3D - Exterior" = whole | BIM |
| Zoom region | drag a rectangle → camera fit to it, tool ends | Interior |
| Pan tool | drag pans (also Shift / middle drag in any mode) | Interior |
| Snapshot | PNG at 2× the on-screen device pixels, saved through the download handler (save dialog in the app) | Interior 1456 × 956 px |
| Walkthrough (Interior) | eye 1.6 m in the current room, full-height walls; W/S/A/D, ←/→ turn, drag = look, wheel = forward/back, Esc ends | Interior |
| Exploded (Interior) | furniture lifts 600 mm, cabinets open panel by panel (`explodeScene`) | Interior |
| Open plan (Interior inset) | top view of the live model + fit | manual |

## Fixes found on the way

- **Camera moves were scaled wrong.** The offscreen OCCT window is a 64 × 64 stub (frames render into FBOs), so
  V3d's pixel-based `Rotation / Pan / ZoomAtPoint / WindowFit` read device pixels against a 64 px window: pan
  jumped the model off-screen, zoom steps were huge. Orbit (turntable about world Z), pan, zoom-at-cursor and
  window fit are now computed on `Graphic3d_Camera` directly from the frame size.
- **Downloads did nothing in the desktop app** (CSV, G-code, ZIP, PNG…): QtWebEngine ignores download requests
  unless accepted. The app now asks where to save (`THCAD_DOWNLOAD_DIR` saves without asking, for QA).
- BIM's live view moved to the shared scene engine (`scene3dLoadBim` → `SceneView::addBuilding`): walls with
  openings, glazing and floor slabs; glass is see-through in the raster view; click-pick selects walls and
  doors/windows.

Grabs: `qa/view3d_*.png`.
