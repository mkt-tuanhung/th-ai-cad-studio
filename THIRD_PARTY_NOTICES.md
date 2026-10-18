# Third-party software in TH AI CAD Studio

The installers (macOS `.dmg`, Windows `.exe`) include the components below. Each one keeps its own
license; the full license texts ship with the installer under `licenses/`.

| Component | Use | License | Notes |
|---|---|---|---|
| Qt 6 (Core, Gui, Widgets, WebEngine, WebChannel, Network) | desktop host, web view | LGPL-3.0 | dynamically linked; Qt WebEngine includes Chromium (BSD-3-Clause and others) |
| Open CASCADE Technology 7.9 | 3D solids, STEP, offscreen 3D view | LGPL-2.1 with OCCT exception | dynamically linked |
| llama.cpp / ggml | local AI runtime (Metal on macOS, Vulkan on Windows) | MIT | |
| Vulkan loader (Windows) | GPU access for ggml's Vulkan backend | Apache-2.0 | from vcpkg; the GPU driver provides the rest |
| **LibreDWG 0.14** (`dwg2dxf`, `dwgadd`, `dxf2dwg`) | opening and saving `.dwg` files (with layouts) | **GPL-3.0-or-later** | shipped as a **separate program**, run as a child process; not linked into the app. The complete source of the shipped version is included in the installer (`licenses/libredwg/`). See `native/third_party/libredwg/README.md` |
| **whisper.cpp 1.9.4** (`whisper-cli`) | Voice CAD speech recognition | MIT | separate program, run as a child process (its own ggml); see `native/third_party/whisper/README.md` |
| GNU libiconv (Windows only) | character sets for LibreDWG | LGPL-2.1-or-later | DLL from the LibreDWG Windows build |
| GLib, GNU gettext (libintl), D-Bus, Graphite2 (macOS) | pulled in by Qt / HarfBuzz (Homebrew builds) | LGPL-2.1-or-later (GLib, libintl), AFL-2.1 OR GPL-2.0-or-later (D-Bus), LGPL-2.1-or-later OR MPL-2.0 (Graphite2) | dynamically linked, in `Contents/Frameworks` |
| ICU, HarfBuzz, FreeType, OpenSSL 3, PCRE2, zstd, Brotli, libpng, libjpeg-turbo, double-conversion, MD4C, libb2, oneTBB, LLVM libomp | text, fonts, TLS for model downloads, images, compression, threads (Qt, OCCT, ggml) | Unicode-3.0, MIT, FTL, Apache-2.0, BSD-3-Clause, libpng-2.0, IJG, CC0-1.0, Apache-2.0 WITH LLVM-exception | dynamically linked; versions in `docs/SBOM.json` |
| React, React DOM | UI | MIT | |
| zustand | UI state | MIT | |
| lucide-react | icons | ISC | |
| earcut | polygon triangulation (GPU 2D layer) | ISC | |
| delaunator | terrain TIN (Civil) | ISC | |
| pdf.js (pdfjs-dist 4.10.38) | Scan to CAD: reading vector PDFs | Apache-2.0 | |
| tesseract.js 5.1.1 (Tesseract OCR + Leptonica, WASM) | Scan to CAD: reading text in scans | Apache-2.0 (Tesseract), BSD-2-Clause (Leptonica) | runs offline in a web worker |
| Tesseract model `vie` (tessdata_best 4.1.0) | Vietnamese OCR | Apache-2.0 | shipped in `ui/ocr/lang/` (12.4 MB) |
| Roboto (Fontsource) | UI font | SIL Open Font License 1.1 | |

The complete, machine-readable list (every UI package, native library, plug-in, helper, model and bundled
asset, with version, licence and how it is distributed) is `docs/SBOM.json`, made by `ui/tools/make-sbom.mjs`
and checked by `ui/tools/check-sbom.mjs` (fails when anything shipped has no entry).

## Not included in the installers

- **AI models** (GGUF) are downloaded separately into the user's models folder. Their licenses are
  not the app's:
  - **Qwen2.5-7B-Instruct** is under Apache-2.0.
  - **Qwen2.5-3B-Instruct** is under the *Qwen Research License*, which restricts commercial use.
  - **Whisper large-v3-turbo** (`ggml-large-v3-turbo-q5_0.bin`, speech) is under MIT; it is downloaded from Settings → Manage Models when the user asks.
  - Check the model license before shipping a model, or before using it commercially.
- **3D interior library** (furniture / decor models, PBR materials, HDRI skies) is downloaded only when the user
  presses “Tải thư viện nội thất mẫu (Poly Haven, CC0)” or downloads one asset in the 3D library dialog, into
  `<app data>/library/` (next to the AI models folder). Nothing of it is in the repository or the installers.
  - **Poly Haven** assets (https://polyhaven.com) are **CC0 1.0** (public domain dedication): free for any use, no
    attribution required. Each asset's page, author(s) and licence are kept in `library/library.json` (`source`,
    `license`) and shown in the library dialog.
  - Pieces the user imports from other sites (Sketchfab, 3dsky, manufacturers…) keep the source / licence text the
    user entered (a required field); the user is responsible for their licence.
- **Blender** (GPL) is not bundled: the user's own installation runs `md_render.py` (renders) and `md_library.py`
  (3D file import / measuring) as separate background processes.
