# Missing production assets

The Pixel-Lock v2 pack contains no clean source artwork for screens 05–12. Until clean assets
arrive, the app uses **DEMO** crops taken from the approved mockups:

- Only the image area is cropped. No buttons, text or panels are included.
- Badges and stars that were baked into an image were removed with OpenCV inpainting (Telea).
- The UI badges are real components drawn on top of the image.
- Every crop is listed in `ui/public/assets/v2/MANIFEST.md`.

These images may only be used as demo previews. They are never fed into the CAD/BIM engine.

## Requested assets

Coordinates are in mockup pixels (x, y, w, h). "Needed" is the minimum clean size, at 2× for Retina.

| # | Screen | Region (mockup) | Content | Needed | Current state |
|---|---|---|---|---|---|
| 05-01 | 05 Projects | 291, 294, 220 × 114 | Villa Riverside — exterior photo (card) | 440 × 228 | DEMO crop, Active badge and ★ inpainted |
| 05-02 | 05 Projects | 528, 294, 215 × 114 | TH Office Building — exterior | 440 × 228 | DEMO crop |
| 05-03 | 05 Projects | 760, 294, 214 × 114 | Pump Assembly — product render | 440 × 228 | DEMO crop; small inpaint residue at the top edge |
| 05-04 | 05 Projects | 991, 294, 212 × 114 | Apartment Interior — interior photo | 440 × 228 | DEMO crop |
| 05-05 | 05 Projects | 290, 543, 220 × 110 | Factory Extension — steel frame | 440 × 228 | DEMO crop |
| 05-06 | 05 Projects | 528, 543, 215 × 110 | Urban Master Plan — aerial | 440 × 228 | DEMO crop |
| 05-07 | 05 Projects | 760, 544, 214 × 109 | Hospital Building — BIM model | 440 × 228 | DEMO crop |
| 05-08 | 05 Projects | 991, 543, 213 × 110 | Bridge Structure — cable-stayed bridge | 440 × 228 | DEMO crop |
| 05-09 | 05 Projects | 1229, 191, 312 × 149 | Villa Riverside — inspector hero | 624 × 298 | DEMO crop, Active badge and Edit inpainted |
| 05-10 | 05 Projects | card footers, inspector, activity | Team avatars (Hoàng Trần, Linh Nguyễn, Minh Phạm + pair composites) | 64 × 64 each, transparent | DEMO crops (26 px source) — need real user photos or an initials avatar policy |
| 05-11 | 05 Projects | — | Thumbnails for the other 16 projects in the catalogue | 440 × 228 | Not present: neutral discipline icon placeholder (no stock art) |

The table will be extended for screens 06–12 as they are built. Screens 08–12 need the most:
MEP / interior / mechanical / render viewports, satellite map, material swatches, component
product renders.
