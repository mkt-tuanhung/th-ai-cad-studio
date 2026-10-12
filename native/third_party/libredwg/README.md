# LibreDWG (DWG reader helper)

TH AI CAD Studio opens `.dwg` files by running LibreDWG's `dwg2dxf` (and saves them with `dwgadd`) as a **separate program**
(child process, files on disk in between). The application does not link LibreDWG.

- License: **GPL-3.0-or-later** (`COPYING`). The complete corresponding source of the exact version
  shipped is included in every installer (`Resources/licenses/libredwg/` on macOS,
  `libredwg\source\` on Windows), as GPL-3.0 §6(a) requires for binaries distributed with it.
- macOS: `dwg2dxf` + `libredwg.0.dylib` from Homebrew `libredwg` 0.14, built from
  `libredwg-0.14.tar.gz` (sha256 `cb6ee0b078c6d9e0f09d66f1feac33ba6342df88ae544e9f9335fab475218351`).
- Windows: official build `libredwg-0.14.8601-win64.zip` from github.com/LibreDWG/libredwg releases
  (sha256 `439cd08d888f3bc2f643cabade0374dfd8670f18d2098cd039cbe64d12a57b19`), source
  `libredwg-0.14.8601.tar.xz` (sha256 `f1140a219d6edb291e55fad740be6c5e49c046fee558860575aeef110caa4ef9`).
  It also needs `libiconv-2.dll` (GNU libiconv, LGPL-2.1-or-later), shipped from the same zip.
- Downloads are cached in `third_party/downloads/` (not committed) and verified by sha256.
