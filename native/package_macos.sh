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
