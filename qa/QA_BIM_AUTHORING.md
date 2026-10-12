# QA — BIM authoring: drawing tools, Structure view, IFC 4 export

## Drawing tools (plan of the current level, `ui/src/screens/bim/BimPlan.tsx`)

The Plan tab is now drawn from the BIM model itself (walls cut at 1.2 m, openings with door swings /
window lines, columns, slabs, stairs with UP arrow and riser count, railings, rooms with area, components,
grids, dimensions, tags, model text). Every ribbon tool creates a validated, undoable model element that the
schedules, model checks and the OCCT 3D view pick up.

| Tool | Interaction | Element |
|---|---|---|
| Wall / Curtain Wall | click start, then each corner (chain); Shift = free angle; Esc / double-click ends; snaps to wall ends, grid ends, columns, 50 mm | `Wall` with x, y, angle; type from the bar (Generic 200 / 150 / 250, Curtain CW100) |
| Door / Window | click on a wall (preview highlights the host) | hosted `Opening`, 900 / 1500 mm, centred on the click, clamped inside the wall |
| Column | click | 400 × 400 to the level above |
| Slab / Roof / Ceiling | two corners | floor (top at level), roof (on level), ceiling (+2.7 m) |
| Stair | foot, then top of run | straight run to the level above; risers ≤ 180 mm (Level 1→2: 17 × 176.5 mm) |
| Room | click inside walls | rectangle found by ray casting to the inner wall faces; area computed |
| Railing | points, Enter / double-click | posts ≤ 1.2 m, top rail, mid rail |
| Component | click | generic furniture box (editable W/D/H/rotation) |
| Level | dialog | name + elevation, unique |
| Model Text / Dimension / Tag / Grid | click / two clicks / click an element / two clicks | plan annotations; grids A, B… or 1, 2… |

Select tool: click picks (annotations → components → columns → stairs → openings → walls → railings → grids
→ rooms → slabs), drag pans, wheel zooms, Delete removes (a wall takes its doors / windows), ⌘Z undoes.
Properties panel edits every new element (width, depth, levels, thickness, height, rotation, text…).

`tools/smoke-bim-draw.mjs` — **11/11 PASS** (W25 4 m, D13 / WN19 hosted on it, column + edit + delete + undo,
slab, stair 17R, grid A, dimension, room 16.2 m², curtain wall 7 m, railing 3 points, component, tag, model text
“Phòng khách”, Level 4 at 12 000 mm). `tools/smoke-bim.mjs` updated (Wall tool, IFC export) — PASS.

Desktop (`native/app/resources/e2e_bimdraw.js`) — **PASS**: the building + 10 drawn elements build as 35 OCCT
solids (curtain wall glass + mullion frame, 4 columns, balcony slab, roof, stair, railing, bench); isolating the
stair shows its 17 steps. Grabs `qa/bim_draw_3d.png`, `qa/bim_draw_stair.png`, `qa/bim_draw_plan.png`.

## Structure discipline

Breadcrumb Architecture ▾ → Structure: plan and 3D show only load-bearing elements (concrete walls, columns,
floor / roof slabs, stairs); partitions, curtain walls, glazing, ceilings, railings, furniture and rooms hide.

## IFC 4 export (Export ▾ → IFC 4 (.ifc), `ui/src/bim/ifc.ts`)

Checked independently with IfcOpenShell 0.8 (`tools/check_ifc.py`) on the villa + one of each drawn element:

- schema IFC4, 2 043 entities, **0 validation issues**
- **64 / 64 products build geometry** (walls cut by their openings, doors, windows, slabs, covering, columns
  incl. round, stair, railing, furniture, curtain wall)
- volumes: W1 2.172 m³ (= 2.55 − door D2 0.378), W3 1.008 m³ (= 1.26 − D4 0.252), stair 5.718 m³,
  floor slab 6.624 m³, roof 27.09 m³ — all exact
- storeys Level 1 / 2 / 3 / Roof with 35 / 20 / 7 / 1 contained elements; IfcSpace “107 Phòng khách”
  (Vietnamese through `\X2\` escapes)

Not exported: grids and plan annotations (2D documentation, not model elements in Reference View).
