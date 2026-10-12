# QA — CAD 2D: TRIM, HATCH, OFFSET, PLOT, layouts

Date: 2026-10-12 · build: macOS arm64, native engine + UI from `ui/` (Vite dev server).

## What is new

| Command / feature | Behaviour |
|---|---|
| **TRIM** | Pick the part of a line / arc / circle / polyline (open or closed) to cut away; every other entity is a cutting edge. Intersections are exact (line–line, line–arc, arc–arc), and a circle trimmed between two cuts becomes an arc. One undoable change (replace + add) that is mirrored to the native command bus. |
| **HATCH** | Pick inside a closed boundary: a closed polyline, a circle, or a region closed by line segments. The result is a filled closed polyline (SOLID in DXF/DWG, triangulated), and its area is reported. |
| **OFFSET** | Lines, circles and arcs as before, plus polylines (mitred corners, open or closed) and arcs. Other kinds report clearly that they are not supported. |
| **PLOT** | Plots the active layout (paper + scale) to a vector PDF. From Model it plots A3 at the fitting scale. |
| **Layouts** | Each drawing has a list of layouts, each with a name, paper (A4–A0) and scale (1:n or fit). “+” adds a layout and 🗑 deletes one. The preview is the same SVG page that is plotted, so what is shown is what prints. |
| **Sheet Set** | Plots every layout into ONE multi-page PDF on the desktop (native `cadExportPdf({pages:[…]})`, `QPdfWriter::newPage`, and a page size per page). In the browser it opens a print window with one page per layout. |

## Evidence

- Unit (`UNIT=edit node tools/test-cam.mjs`):
  - A line trimmed between two cutters leaves [0,30] and [70,100].
  - A circle trimmed by a line becomes an arc from 180° to 0°.
  - The hatch area of a 10×10 square is 100.
  - An L shape triangulates to 4 triangles with area 75.
  - The polyline offset perimeter is 144.
  - DWG writer count: SOLID = 2.
- DWG round trip: the written DWG is read back with 4 SOLID + 1 LWPOLYLINE.
- `node tools/smoke-cad2d.mjs`: all steps PASS, including the TRIM step and “Layouts: Layout1 sheet; add a layout, set A4 1:200, delete it”.
- Desktop e2e (`THCAD_QA=1 THCAD_PDF_OUT=<file> THCAD_SCRIPT=…/e2e_layouts.js`): 4/4 PASS.
  - “+” adds Layout3.
  - The preview follows A4 1:200.
  - Plot this layout gives a vector PDF at A4 1:200.
  - Sheet set writes one PDF with 3 pages.
- Checked with `pdfinfo` / MediaBox: 3 pages of 420×297, 841×594 and 297×210 mm (A3, A1, A4 landscape). The rasterised page 3 (`cad_sheetset_p3.png`) matches the on-screen preview (`cad_layout_a4.png`).

## Limits (honest)

- Layouts are stored with the drawing in the app; they are **not** written into DXF/DWG paper space. Exported DXF/DWG keep model space only.
- Deleting a layout is not on the undo stack.
- HATCH fills solid. There are no pattern hatches (ANSI31 …).
