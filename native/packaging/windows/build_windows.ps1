# Builds the Windows installer "TH-AI-CAD-Studio-Setup-<ver>.exe" (x64, MSVC).
# Run in "x64 Native Tools Command Prompt for VS 2022" → powershell, from native\packaging\windows:
#   .\build_windows.ps1                 # unsigned (SmartScreen shows a warning on first run)
#   .\build_windows.ps1 -SignCmd "..."  # optional: a signtool command line for a code-signing cert
# Prerequisites (all free): Visual Studio 2022 Build Tools (C++), CMake ≥ 3.24, Ninja, Node.js 20+,
# Python 3 (for aqtinstall), Git, vcpkg (VCPKG_ROOT set), Inno Setup 6 (iscc on PATH).
param(
  # 6.10.3: newest Qt whose online repository layout aqtinstall 3.3 can read (6.11.x moved to a new layout)
  [string]$QtVersion = "6.10.3",
  [string]$QtRoot = "C:\Qt",
  [string]$SignCmd = ""
)
$ErrorActionPreference = "Stop"
# native tools do not throw on failure: stop on the first non-zero exit code
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }
$Native = Resolve-Path "$PSScriptRoot\..\.."
$Ui = Resolve-Path "$Native\..\ui"
$Build = "$Native\build-win"
$Stage = "$Native\dist-win\TH AI CAD Studio"

# 1) Qt 6 + WebEngine (MSVC 2022 x64) via aqtinstall
$QtDir = "$QtRoot\$QtVersion\msvc2022_64"
if (-not (Test-Path "$QtDir\bin\qmake.exe")) {
  python -m pip install --upgrade aqtinstall; Check "pip"
  python -m aqt install-qt windows desktop $QtVersion win64_msvc2022_64 -O $QtRoot -m qtwebengine qtwebchannel qtpositioning; Check "aqt install-qt"
}

# 2) Open CASCADE + llama.cpp via vcpkg (manifest: vcpkg.json next to this script)
& "$env:VCPKG_ROOT\vcpkg.exe" install --triplet x64-windows --x-manifest-root "$PSScriptRoot" --x-install-root "$Build\vcpkg"; Check "vcpkg install"
$VcpkgPrefix = "$Build\vcpkg\x64-windows"

# 3) Web UI
Push-Location $Ui; npm ci; Check "npm ci"; npm run build; Check "npm run build"; Pop-Location

# 4) Native build
cmake -S $Native -B $Build -G Ninja -DCMAKE_BUILD_TYPE=Release `
  "-DCMAKE_PREFIX_PATH=$QtDir;$VcpkgPrefix" -DTHCAD_BUILD_TESTS=ON; Check "cmake configure"
cmake --build $Build; Check "cmake build"
# the test executables load the OCCT / llama.cpp / Qt DLLs from vcpkg and Qt
$env:PATH = "$VcpkgPrefix\bin;$QtDir\bin;$env:PATH"
ctest --test-dir $Build --output-on-failure; Check "ctest"

# 5) Stage: exe + Qt runtime (windeployqt) + OCCT/llama DLLs + ggml backends + UI
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item "$Build\app\TH AI CAD Studio.exe" $Stage
Copy-Item -Recurse "$Build\app\ui" "$Stage\ui"
& "$QtDir\bin\windeployqt.exe" --release --no-translations --no-system-d3d-compiler --no-opengl-sw "$Stage\TH AI CAD Studio.exe"; Check "windeployqt"
Copy-Item "$VcpkgPrefix\bin\*.dll" $Stage
New-Item -ItemType Directory -Force "$Stage\ggml" | Out-Null
Get-ChildItem "$VcpkgPrefix\bin\ggml-*.dll" -ErrorAction SilentlyContinue | Copy-Item -Destination "$Stage\ggml"

# 5b) DWG reader: LibreDWG dwg2dxf as a separate GPL-3.0 program (child process, never linked),
#     with its license and the complete source of the shipped version (third_party/libredwg/README.md)
$Dl = "$Native\third_party\downloads"
New-Item -ItemType Directory -Force $Dl | Out-Null
function Fetch($url, $sha) {
  $out = Join-Path $Dl (Split-Path $url -Leaf)
  if (-not (Test-Path $out) -or (Get-FileHash $out -Algorithm SHA256).Hash -ne $sha) { Invoke-WebRequest $url -OutFile $out }
  if ((Get-FileHash $out -Algorithm SHA256).Hash -ne $sha) { throw "sha256 mismatch: $out" }
  return $out
}
$Rel = "https://github.com/LibreDWG/libredwg/releases/download/0.14.8601"
$Zip = Fetch "$Rel/libredwg-0.14.8601-win64.zip" "439CD08D888F3BC2F643CABADE0374DFD8670F18D2098CD039CBE64D12A57B19"
$Src = Fetch "$Rel/libredwg-0.14.8601.tar.xz" "F1140A219D6EDB291E55FAD740BE6C5E49C046FEE558860575AEEF110CAA4EF9"
$Tmp = "$Build\libredwg"
Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
Expand-Archive $Zip -DestinationPath $Tmp
New-Item -ItemType Directory -Force "$Stage\libredwg", "$Stage\licenses\libredwg" | Out-Null
foreach ($f in "dwg2dxf.exe", "libredwg-0.dll", "libiconv-2.dll") { Copy-Item "$Tmp\$f" "$Stage\libredwg\" }
Copy-Item $Src "$Stage\licenses\libredwg\"
tar -xJf $Src -C $Tmp "libredwg-0.14.8601/COPYING"
Copy-Item "$Tmp\libredwg-0.14.8601\COPYING" "$Stage\licenses\libredwg\COPYING"
Copy-Item "$Native\third_party\libredwg\README.md" "$Stage\licenses\libredwg\"
Copy-Item "$Native\..\THIRD_PARTY_NOTICES.md" "$Stage\licenses\"
& "$Stage\libredwg\dwg2dxf.exe" --version; Check "dwg2dxf --version"

# 6) Optional signing, then the installer
if ($SignCmd) { Invoke-Expression "$SignCmd `"$Stage\TH AI CAD Studio.exe`"" }
$Version = (Select-String -Path "$Native\CMakeLists.txt" -Pattern 'VERSION (\d+\.\d+\.\d+)').Matches[0].Groups[1].Value
iscc "/DAppVersion=$Version" "/DStageDir=$Stage" "/O$Native\dist-win" "$PSScriptRoot\installer.iss"; Check "iscc"
$Setup = "$Native\dist-win\TH-AI-CAD-Studio-Setup-$Version.exe"
if ($SignCmd) { Invoke-Expression "$SignCmd `"$Setup`"" }
Write-Host "Installer: $Setup"
