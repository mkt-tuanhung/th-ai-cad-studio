# QA — MEP authoring: plan, drawing tools, colour filter, visibility, section

Browser → Floor Plan - MEP / Ceiling Plan - Services (or any drawing tool) opens the plan of the current
level drawn from the model (`ui/src/screens/mep/MepPlan.tsx`): beams (dashed), ducts at width with
mark + size, pipes at DN width, cable trays, fixtures (lights, sockets, WC, basin, sink, drain, sprinkler
symbols), air terminals, fittings, notes, dimensions, tags, section lines. The ceiling plan keeps what is
above the ceiling (ducts, terminals, lights, sprinklers, trays).

| Tool | Interaction | Element (all undoable, validated) |
|---|---|---|
| Duct | start → end (straight along X / Y, chained; Esc ends) | Supply Air 400 × 300, 480 L/s, +2 650 mm |
| Pipe | start → end, service picker | DN by service (drain 100, sprinkler 32, others 25), flow at 1 m/s |
| Cable Tray | start → end | Power 300 × 100 at +2 400 |
| Fixture | click, kind picker | 8 kinds at their mounting height |
| Terminal | click | 600 mm supply diffuser, 150 L/s, face velocity shown |
| Fitting | click where runs meet | kind from the runs there: Cap (1 end), Elbow (2 at 90°), Coupling (2 in line), Tee (3), Cross (4) |
| Annotation / Dimension / Tag | click / 2 clicks / click an element | tag shows mark + size (SA-01 600×400, SAN-05 DN80…) |
| Section | 2 clicks | the 3D view cuts a 1.2 m slice along the line (4 clip planes, capped) and looks across it |
| Color Filter | menu | By system / By velocity (green ≤ 60 % of the limit, amber ≤ limit, red over) / Clashes only — plan and 3D |
| Visibility | check-box menu | ducts, pipes, trays, fixtures, terminals, fittings, beams, annotations — plan and 3D |

Pipes are now editable in Properties (DN, flow, elevation); trays, fixtures, terminals have their own panels;
a section has "Show in 3D". Delete removes the selection (fittings on a removed run and its tags go too).

## Results (2026-10-12)

- `tools/smoke-mep-draw.mjs` **8/8 PASS**; `tools/smoke-mep.mjs` 11/11 PASS (unchanged behaviour).
- Desktop `native/app/resources/e2e_mepdraw.js` **5/5 PASS**: tray, 5 fixtures, diffuser, fitting build with the
  runs (42 OCCT solids); velocity filter recolours; hiding beams 42 → 36 solids; the S-1 section line slices
  the 3D view; removing the section box clears the plan section. Grabs `qa/mep_draw_*.png`.
