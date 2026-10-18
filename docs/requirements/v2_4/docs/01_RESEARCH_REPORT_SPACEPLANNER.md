# RESEARCH REPORT — SpacePlanner.co benchmark (18 October 2026)

## Scope and evidence
Source: https://spaceplanner.co/ (product homepage) and current https://spaceplanner.co/docs (public help pages). This is documentary research, not an audited live hands-on evaluation of every logged-in feature. Confirm in app during validation. Research only product ideas; **do not reproduce proprietary code, drawings, assets or exact UI layout**.

### Documented working design concepts
1. **Single 2D/3D design model:** As walls, doors, windows, floors, furniture, roofs and stairs change in plan, the 3D scene updates without manually rebuilding the model. https://spaceplanner.co/docs/3d-view
2. **Intuitive precise floor planning:** Walls, rectangular/L/polygon/round rooms, curved walls, dimensions, snapping; doors/windows and opening swing, furniture fit/size; multi-level, split levels; roofs, stairs, terrace, landscaping. https://spaceplanner.co/docs and https://spaceplanner.co/docs/getting-started
3. **Furniture catalog:** Search-by-room, placement of 2D symbols plus corresponding 3D models, parametric dimensions (width/depth/height), elevation, per-part finish, replacement in place. https://spaceplanner.co/docs/furniture-library
4. **Finishes:** Materials/paint for surfaces, grain/scale/tint controls. https://spaceplanner.co/docs/finishes-materials
5. **Architectural output from model:** Automatic elevations and sections which update when model changes; editable sill/window placement in elevations. https://spaceplanner.co/docs/elevations
6. **3D navigation and presentation:** Orbit/pan/zoom, floor control, camera, room framing, mini-map, cutaway/low walls/see-through, first-person walkthrough, save camera views; Day/Golden/Night lighting. https://spaceplanner.co/docs/3d-view
7. **Realistic image render:** Current camera -> photo-like Medium/High/4K image, preview-vs-render slider, background render queue. Site states two trial credits and credit pricing; not a purely free unlimited renderer. Rendered image is an AI impression **not to scale**. https://spaceplanner.co/docs/3d-view and https://spaceplanner.co/
8. **Electrical plan:** Symbols for lights/switches/outlets/panels and routed wires; schedules/legends. https://spaceplanner.co/ and https://spaceplanner.co/docs
9. **Exports:** PDF print true scale A4–A0 with floor/elevation/section sheets, lineweight and dimension layer options, PDF/PNG/SVG, editable DXF 1:1, JSON and 3D GLB; DWG listed as forthcoming in export docs. https://spaceplanner.co/docs/export-pdf
10. **Project usability:** templates, one-click tool search, grouped/layer visibility, saving/version history, mobile/touch use, share snapshot editable copies, six website languages (not Vietnamese). https://spaceplanner.co/docs

### Critical fact check: Image/PDF -> editable plan via AI
- Homepage claims upload photo/sketch/PDF -> AI rebuilds walls, rooms, doors, windows and furniture.
- But CURRENT import help says manual underlay is PNG/JPG only; direct PDF/DWG not accepted in manual upload, and **`Rebuild with AI` tab is labeled 'Soon', automatic reconstruction paused**.
- Therefore public docs **do not verify** active production image/PDF AI rebuilding right now. Need preserve this distinction in product research and update spec.
- https://spaceplanner.co/ vs https://spaceplanner.co/docs/import

### What SpacePlanner docs do NOT substantiate
- Automated cabinetry production Cut List, drill maps, kerf/grain/edge banding, nesting, machine-aware multi-head CNC and proven G-code output.
- End-to-end agentic engineering from one natural-language request to verified construction/CNC outputs.
- Full AutoCAD, SketchUp or 3ds Max feature/shortcut equivalence.
- Offline local generation (their realistic render uses credits).

## Strategic conclusions for MD CAD AI STUDIO
**Adopt independently:** fast parametric room creation, automatic 2D↔3D sync, geometry-connected material preview, furniture swap, quick day/night view, cutaway walkthrough, camera bookmark, photoreal local renders, automatic drawings/schedules/export, template gallery, unified search and AI intent commands.

**Go beyond for production:** CAD/BIM entities with stable GUIDs and mm dimensions; image/PDF AI reconstruction with uncertainty review; indoor cabinet maker and manufacturing feature graph; approved measurements; BOM/edge/grain; machine-aware nesting and CAM post; NC emission only after machine/fixture/tool verification plus supervised acceptance.

## Design inspiration != copied visual UI
The approved Apple graphite/teal **MD CAD AI STUDIO** AppShell + pixel-lock retains priority over SpacePlanner's website look. These are function inspirations; introduce new modes inside the existing app; designer approval is required if altering existing locked screen geometry.
