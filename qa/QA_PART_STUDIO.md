# QA — Mechanical Part Studio (feature modeling) and CAM Prep

## Feature modeling (OCCT, `native/libs/geom_occt/src/part.cpp`)

A part is sketches (rectangle, circle, polygon, slot on Top XY / Front XZ / Right YZ with an offset) and an
ordered feature list evaluated by OCCT: **Extrude** (add / cut, reverse, symmetric, through all),
**Revolve** (about the sketch's u or v axis, any angle), **Hole** (starts on the material under it — a
vertical ray finds the top surface — through or blind, counterbore), **Fillet / Chamfer** (edge sets:
vertical profile corners, top face, bottom face, circular, all; cylinder seams excluded), **Pattern**
(linear / circular, repeats the source feature's own tool body). A feature that fails is skipped and its
kernel reason is shown in the tree; the part keeps the body before it.

Native unit tests (`thcad_tests`, 35/35):

| Part | Expected (analytic) | OCCT |
|---|---|---|
| plate 100×60×10, 3 × Ø10 through (pattern), vertical corners R5 | 57 429.2 mm³ | exact (±0.5) |
| revolve 10 × 20 rectangle on XZ about v | π·10²·20 = 6 283.2 mm³ | exact |
| 20 mm cube, top edges chamfer 2 | 7 800…7 900 mm³, valid | ✓ |
| 20×20×5 plate with fillet R15 on vertical edges | fails, reported, volume stays 2 000 mm³ | ✓ |
| **Bearing bracket** (sample): plate 120×80×12 R6, boss Ø44×18, bore Ø25 through, 4 × Ø9 cb Ø15×5 (2 patterns) | 122 156.93 mm³ | **122 156.93 mm³** |

Desktop (`native/app/resources/e2e_part.js`) **4/4 PASS**: volume 122 156.9 mm³, mass 0.959 kg (AISI 1045),
a fillet R80 shows "fillet R80 does not fit the vertical edges (OCCT: …)" in the tree with the volume unchanged,
STEP export 69 KB. Grab `qa/part_bracket_3d.png`.

UI: Part tab / + / Part ▾ (sample bracket or blank part), document tab per part, Feature Tree (edit, suppress,
delete with dependants, undo), Sketch dialog (drag rectangles / circles, click polygons, numeric edit, 1 mm grid),
feature dialogs, Properties (material, density, OCCT volume, mass, bounding box, failed features, STEP),
Dimension = overall size. Browser build: sketch top-view preview, labelled (the solid needs the desktop kernel).

## CAM Prep (`ui/src/mech/partCam.ts`) — 3-axis, one top setup

Stock = XY extrudes + 2 mm sides, +1 mm top. Operations: face; per extrude level from the top, zig-zag roughing
clipped to the outline + tool radius + 0.2 mm, then the finished outline per stepdown; pockets of XY cut extrudes
that open on the top surface (others are listed as "second setup"); helical milling of bores larger than the
biggest drill and of counterbores; drilling (explicit pecks, 1 × Ø, no canned cycles) with HSS-Co drills sized
from the hole. Speeds and feeds from the material (Vc, fz). ISO (T… M6) or GRBL (M0 pause per tool).

Every program is re-read by the independent simulator (`simulate()`): bracket → **0 errors**, 4 884 lines,
cut 29.1 m, ~65 min. In the smoke test a pocket drawn outside the part made the simulator report
"moves leave the sheet" — kept as a guard.

`tools/smoke-part.mjs` **7/7 PASS**; all 15 browser suites green.
