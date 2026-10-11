#!/bin/zsh
# Packages native/dist/TH AI CAD Studio.app (from ../../package_macos.sh) into a .dmg.
#
#   ./make_dmg.sh                         free: ad-hoc signature + hardened runtime. Users open it the
#                                         first time via right-click → Open (or System Settings →
#                                         Privacy & Security → Open Anyway).
#   DEVELOPER_ID="Developer ID Application: Name (TEAMID)" NOTARY_PROFILE=thcad ./make_dmg.sh
#                                         paid ($99/yr Apple Developer Program): signed + notarized +
#                                         stapled, opens without any warning. Create the profile once:
#                                         xcrun notarytool store-credentials thcad --apple-id … --team-id …
set -euo pipefail
cd "$(dirname "$0")/../.."
APP="dist/TH AI CAD Studio.app"
ENT="packaging/macos/entitlements.plist"
VERSION=$(sed -nE 's/^project\(THAICADStudio VERSION ([0-9.]+).*/\1/p' CMakeLists.txt)
DMG="dist/TH-AI-CAD-Studio-${VERSION}-macOS-arm64.dmg"
[[ -d "$APP" ]] || { echo "missing $APP — run ./package_macos.sh first" >&2; exit 1; }

IDENTITY="${DEVELOPER_ID:--}"
# inside-out signing: nested code first, then the app (with hardened runtime + entitlements)
TS=--timestamp=none
if [[ "$IDENTITY" != "-" ]]; then TS=--timestamp; fi
sign() { codesign --force $TS --options runtime --sign "$IDENTITY" "$@"; }
find "$APP/Contents" \( -name "*.dylib" -o -name "*.so" \) -type f | while read -r f; do sign "$f"; done
for fw in "$APP"/Contents/Frameworks/*.framework; do
  # QtWebEngineCore embeds the Chromium helper app — sign it with the same entitlements first
  find "$fw" -name "*.app" -type d | while read -r h; do sign --entitlements "$ENT" "$h"; done
  sign "$fw"
done
find "$APP/Contents/PlugIns" -name "*.dylib" -type f | while read -r f; do sign "$f"; done
# helper programs (LibreDWG dwg2dxf)
find "$APP/Contents/Helpers" -type f -perm +111 2>/dev/null | while read -r f; do sign --entitlements packaging/macos/helper.entitlements.plist "$f"; done
sign --entitlements "$ENT" "$APP"
codesign --verify --deep --strict "$APP"
echo "signed: $IDENTITY"

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "TH AI CAD Studio" -srcfolder "$STAGE" -fs APFS -format ULMO -ov "$DMG" >/dev/null
rm -rf "$STAGE"
if [[ "$IDENTITY" != "-" ]]; then codesign --force --timestamp --sign "$IDENTITY" "$DMG"; fi

if [[ "$IDENTITY" != "-" && -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
fi
ls -lh "$DMG"
