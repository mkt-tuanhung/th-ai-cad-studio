#!/bin/zsh
# Builds a self-contained, ad-hoc signed "TH AI CAD Studio.app" in native/dist (no Homebrew needed
# on the target Mac). Usage: ./package_macos.sh
set -euo pipefail
cd "$(dirname "$0")"
(cd ../ui && npm run build >/dev/null)
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build
rm -rf dist && mkdir -p dist
cp -R "build/app/TH AI CAD Studio.app" dist/
APP="dist/TH AI CAD Studio.app"
macdeployqt "$APP" -always-overwrite 2>&1 | grep -E "ERROR" | grep -vE "codesign|QtSvg|using QList|invalid signature" || true
# The UI is web-based; Qt's SVG icon engine (needs QtSvg) is not used — drop it.
rm -rf "$APP/Contents/PlugIns/iconengines"
# ggml compute backends (Metal, CPU variants, BLAS) are loaded at runtime from PlugIns/ggml
mkdir -p "$APP/Contents/PlugIns/ggml"
cp /opt/homebrew/opt/ggml/libexec/*.so "$APP/Contents/PlugIns/ggml/"
for so in "$APP"/Contents/PlugIns/ggml/*.so; do
  install_name_tool -add_rpath @loader_path/../../Frameworks "$so" 2>/dev/null || true
done
# DWG reader: LibreDWG `dwg2dxf` shipped as a separate GPL-3.0 program (run as a child process, never
# linked), with its library, license and the complete corresponding source (third_party/libredwg).
LIBREDWG=/opt/homebrew/opt/libredwg
[[ -x $LIBREDWG/bin/dwg2dxf ]] || { echo "error: brew install libredwg (DWG reader)" >&2; exit 1; }
mkdir -p "$APP/Contents/Helpers" "$APP/Contents/Resources/licenses/libredwg"
# DWG writer: LibreDWG `dwgadd` (same terms; builds AutoCAD 2000 DWG from a script)
cp $LIBREDWG/bin/dwg2dxf $LIBREDWG/bin/dwgadd "$APP/Contents/Helpers/"
cp $LIBREDWG/lib/libredwg.0.dylib "$APP/Contents/Frameworks/"
chmod u+w "$APP/Contents/Helpers/dwg2dxf" "$APP/Contents/Helpers/dwgadd" "$APP/Contents/Frameworks/libredwg.0.dylib"
for h in dwg2dxf dwgadd; do install_name_tool -add_rpath @executable_path/../Frameworks "$APP/Contents/Helpers/$h" 2>/dev/null || true; done
SRC=$(third_party/libredwg/fetch.sh https://ftpmirror.gnu.org/libredwg/libredwg-0.14.tar.gz cb6ee0b078c6d9e0f09d66f1feac33ba6342df88ae544e9f9335fab475218351)
cp "$SRC" "$APP/Contents/Resources/licenses/libredwg/"
tar -xzOf "$SRC" libredwg-0.14/COPYING > "$APP/Contents/Resources/licenses/libredwg/COPYING"
cp third_party/libredwg/README.md "$APP/Contents/Resources/licenses/libredwg/"
cp ../THIRD_PARTY_NOTICES.md "$APP/Contents/Resources/licenses/"
# Voice CAD: whisper.cpp `whisper-cli` (MIT), a separate static program (third_party/whisper)
WHISPER=$(third_party/whisper/build_macos.sh)
cp "$WHISPER" "$APP/Contents/Helpers/whisper-cli"
mkdir -p "$APP/Contents/Resources/licenses/whisper"
cp "$(dirname "$WHISPER")/../../LICENSE" "$APP/Contents/Resources/licenses/whisper/LICENSE"
cp third_party/whisper/README.md "$APP/Contents/Resources/licenses/whisper/"
python3 tools/fix_bundle_paths.py "$APP"
# every Mach-O in the bundle must be relocatable
BAD=$(find "$APP" -type f -perm +111 -o -type f -name "*.dylib" | while read -r f; do otool -L "$f" 2>/dev/null | grep -q "/opt/homebrew" && echo "$f"; done || true)
# remaining Homebrew references would break on a clean Mac
if [[ -n "$BAD" ]]; then
  echo "error: still referencing /opt/homebrew:" >&2
  echo "$BAD" >&2
  exit 1
fi
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "signature ok (ad-hoc)"
du -sh "$APP"
