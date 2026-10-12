# QA — Civil: 3D corridor, Intersection, notes / dimensions, chart tools

- **3D tab** (`ui/src/civil/scene3d.ts`, `screens/civil/Civil3D.tsx`): the design template every 10 m
  (lining bottom and side slopes, water at normal depth, 3 m crests at top of bank + 0.30 m, 2:1 outer slopes
  daylighting to the ground), the existing ground (survey TIN — opened where the corridor replaces it — or a
  ±60 m strip from the sample profile) and the culverts as boxes. Surfaces are a new native `mesh` primitive
  (triangle faces, no face-boundary hatching). Vertical exaggeration ×1…×10. Desktop: OCCT scene with pan,
  zoom region, section box, snapshot. Browser: an isometric wireframe of the sections, labelled.
- **Intersection**: road crossing → box culvert at a station (cells, span, rise, road width = culvert length),
  invert taken from the design profile; it appears in Structures, on the profile and in 3D. Refuses a station
  outside the alignment or within 10 m of another structure.
- **Annotation / Dimension** on the profile (station, elevation: length, Δz, grade %) and on a cross section
  (offset, elevation: distance, Δz); undoable; More Tools → remove notes.
- Chart tools: profile window (Pan = centre on the station / zoom in, Zoom = widen, Orbit = whole alignment),
  PNG snapshot of the profile / section / survey plan, Delete = remove that chart's notes; plan Isolate hides
  the surfaces; Zoom region / Full extent drive the survey plan.

Results 2026-10-12: `tools/smoke-civil-tools.mjs` 7/7, `smoke-civil.mjs` 12/12 (its blank-click helper moved:
the 3D tab is live now), `smoke-survey.mjs` 12/12; desktop `e2e_civil3d.js` PASS (6 OCCT items, 3 589
triangles from the survey TIN, ×10 exaggeration rebuild). Grabs `qa/civil_3d*.png`.
