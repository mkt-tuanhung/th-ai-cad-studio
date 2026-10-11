# Builds the Windows installer "TH-AI-CAD-Studio-Setup-<ver>.exe" (x64, MSVC).
# Run in "x64 Native Tools Command Prompt for VS 2022" → powershell, from native\packaging\windows:
#   .\build_windows.ps1                 # unsigned (SmartScreen shows a warning on first run)
#   .\build_windows.ps1 -SignCmd "..."  # optional: a signtool command line for a code-signing cert
# Prerequisites (all free): Visual Studio 2022 Build Tools (C++), CMake ≥ 3.24, Ninja, Node.js 20+,
# Python 3 (for aqtinstall), Git, vcpkg (VCPKG_ROOT set), Inno Setup 6 (iscc on PATH).
param(
  [string]$QtVersion = "6.11.2",
  [string]$QtRoot = "C:\Qt",
  [string]$SignCmd = ""
)
$ErrorActionPreference = "Stop"
$Native = Resolve-Path "$PSScriptRoot\..\.."
$Ui = Resolve-Path "$Native\..\ui"
$Build = "$Native\build-win"
$Stage = "$Native\dist-win\TH AI CAD Studio"

# 1) Qt 6 + WebEngine (MSVC 2022 x64) via aqtinstall
$QtDir = "$QtRoot\$QtVersion\msvc2022_64"
if (-not (Test-Path "$QtDir\bin\qmake.exe")) {
  python -m pip install --upgrade aqtinstall
  python -m aqt install-qt windows desktop $QtVersion win64_msvc2022_64 -O $QtRoot -m qtwebengine qtwebchannel qtpositioning
}

# 2) Open CASCADE + llama.cpp via vcpkg (manifest: vcpkg.json next to this script)
& "$env:VCPKG_ROOT\vcpkg.exe" install --triplet x64-windows --x-manifest-root "$PSScriptRoot" --x-install-root "$Build\vcpkg"
$VcpkgPrefix = "$Build\vcpkg\x64-windows"

# 3) Web UI
Push-Location $Ui; npm ci; npm run build; Pop-Location

# 4) Native build
cmake -S $Native -B $Build -G Ninja -DCMAKE_BUILD_TYPE=Release `
  "-DCMAKE_PREFIX_PATH=$QtDir;$VcpkgPrefix" -DTHCAD_BUILD_TESTS=ON
cmake --build $Build
ctest --test-dir $Build --output-on-failure

# 5) Stage: exe + Qt runtime (windeployqt) + OCCT/llama DLLs + ggml backends + UI
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item "$Build\app\TH AI CAD Studio.exe" $Stage
Copy-Item -Recurse "$Build\app\ui" "$Stage\ui"
& "$QtDir\bin\windeployqt.exe" --release --no-translations --no-system-d3d-compiler --no-opengl-sw "$Stage\TH AI CAD Studio.exe"
Copy-Item "$VcpkgPrefix\bin\*.dll" $Stage
New-Item -ItemType Directory -Force "$Stage\ggml" | Out-Null
Get-ChildItem "$VcpkgPrefix\bin\ggml-*.dll" -ErrorAction SilentlyContinue | Copy-Item -Destination "$Stage\ggml"

# 6) Optional signing, then the installer
if ($SignCmd) { Invoke-Expression "$SignCmd `"$Stage\TH AI CAD Studio.exe`"" }
$Version = (Select-String -Path "$Native\CMakeLists.txt" -Pattern 'VERSION (\d+\.\d+\.\d+)').Matches[0].Groups[1].Value
iscc "/DAppVersion=$Version" "/DStageDir=$Stage" "/O$Native\dist-win" "$PSScriptRoot\installer.iss"
$Setup = "$Native\dist-win\TH-AI-CAD-Studio-Setup-$Version.exe"
if ($SignCmd) { Invoke-Expression "$SignCmd `"$Setup`"" }
Write-Host "Installer: $Setup"
