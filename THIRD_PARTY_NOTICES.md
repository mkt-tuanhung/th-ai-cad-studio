# Third-party software in TH AI CAD Studio

The installers (macOS `.dmg`, Windows `.exe`) include the components below. Each one keeps its own
license; the full license texts ship with the installer under `licenses/`.

| Component | Use | License | Notes |
|---|---|---|---|
| Qt 6 (Core, Gui, Widgets, WebEngine, WebChannel, Network) | desktop host, web view | LGPL-3.0 | dynamically linked; Qt WebEngine includes Chromium (BSD-3-Clause and others) |
| Open CASCADE Technology 7.9 | 3D solids, STEP, offscreen 3D view | LGPL-2.1 with OCCT exception | dynamically linked |
| llama.cpp / ggml | local AI runtime | MIT | |
| **LibreDWG 0.14** (`dwg2dxf`, `dwgadd`, `dxf2dwg`) | opening and saving `.dwg` files (with layouts) | **GPL-3.0-or-later** | shipped as a **separate program**, run as a child process; not linked into the app. The complete source of the shipped version is included in the installer (`licenses/libredwg/`). See `native/third_party/libredwg/README.md` |
| **whisper.cpp 1.9.4** (`whisper-cli`) | Voice CAD speech recognition | MIT | separate program, run as a child process (its own ggml); see `native/third_party/whisper/README.md` |
| GNU libiconv (Windows only) | character sets for LibreDWG | LGPL-2.1-or-later | DLL from the LibreDWG Windows build |
| React, React DOM | UI | MIT | |
| zustand | UI state | MIT | |
| lucide-react | icons | ISC | |
| earcut | polygon triangulation (GPU 2D layer) | ISC | |
| delaunator | terrain TIN (Civil) | ISC | |
| pdf.js (pdfjs-dist 4.10.38) | Scan to CAD: reading vector PDFs | Apache-2.0 | |
| tesseract.js 5.1.1 (Tesseract OCR + Leptonica, WASM) | Scan to CAD: reading text in scans | Apache-2.0 (Tesseract), BSD-2-Clause (Leptonica) | runs offline in a web worker |
| Tesseract model `vie` (tessdata_best 4.1.0) | Vietnamese OCR | Apache-2.0 | shipped in `ui/ocr/lang/` (12.4 MB) |
| Roboto (Fontsource) | UI font | SIL Open Font License 1.1 | |

## Not included in the installers

- **AI models** (GGUF) are downloaded separately into the user's models folder. Their licenses are
  not the app's:
  - **Qwen2.5-7B-Instruct** is under Apache-2.0.
  - **Qwen2.5-3B-Instruct** is under the *Qwen Research License*, which restricts commercial use.
  - **Whisper large-v3-turbo** (`ggml-large-v3-turbo-q5_0.bin`, speech) is under MIT; it is downloaded from Settings → Manage Models when the user asks.
  - Check the model license before shipping a model, or before using it commercially.
