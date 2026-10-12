# QA — Interior plans, Dimension / Tag, elevations and sections

- **Plans from the model** (`ui/src/screens/interior/InteriorPlan.tsx`): Level 1 furniture layout (rooms with
  areas, every item at its placement — the same placements the 3D scene uses, `itemPlacements()`), reflected
  ceiling plan (ceiling heights, lights) and finish plan (rooms coloured by floor finish). Opened from the plan
  inset (Open plan), the browser (Layout A / Ceiling Plan / Finish Plan) or the Dimension / Tag tools. Works in
  the browser build too (no kernel needed).
- **Dimension**: two clicks, snapping to room and furniture corners (10 px) or a 10 mm grid; **Tag**: click an
  item (smallest footprint under the cursor — a sofa over a rug tags the sofa) or a room → name + size / area.
  Undoable; More Tools → remove dimensions and tags.
- **Elevations / sections** (browser: Living / Kitchen elevations, Section A-A / B-B): desktop 3D with walls to
  the ceiling, clip planes and a camera on the cut; "Remove section box" returns to perspective. Browser nodes
  3D - Exploded / 3D - Walkthrough now switch the view.

Results 2026-10-12: `tools/smoke-interior-plan.mjs` 5/5 (living room width dimension 7,670; sofa tag
"Sofa L-Shape · 3200 × 1800 × 780"; ceiling plan Bathroom 1 CH 2,700; finish plan Master Bedroom Wood - Oak),
`smoke-interior.mjs` 13/13, desktop `e2e_interiorcut.js` 4/4. Grabs `qa/interior_elev-*.png`, `qa/interior_sec-*.png`.
