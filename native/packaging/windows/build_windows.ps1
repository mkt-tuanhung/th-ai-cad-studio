# Builds the Windows installer "MD-CAD-AI-STUDIO-Setup-<ver>.exe" (x64, MSVC).
# Run in "x64 Native Tools Command Prompt for VS 2022" → powershell, from native\packaging\windows:
#   .\build_windows.ps1                 # unsigned (SmartScreen shows a warning on first run)
#   .\build_windows.ps1 -SignCmd "..."  # optional: a signtool command line for a code-signing cert
# Prerequisites (all free): Visual Studio 2022 Build Tools (C++), CMake ≥ 3.24, Ninja, Node.js 20+,
# Python 3 (for aqtinstall), Git, vcpkg (VCPKG_ROOT set), Inno Setup 6 (iscc on PATH).
param(
  # 6.10.3: newest Qt whose online repository layout aqtinstall 3.3 can read (6.11.x moved to a new layout)
  [string]$QtVersion = "6.10.3",
  [string]$QtRoot = "C:\Qt",
  [string]$SignCmd = "",
  # also build the unlocked QA app (CI self-test); it is never staged into the installer
  [switch]$QaBuild
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # the progress bar slows Invoke-WebRequest to a crawl
# native tools do not throw on failure: stop on the first non-zero exit code
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }
$Native = Resolve-Path "$PSScriptRoot\..\.."
$Ui = Resolve-Path "$Native\..\ui"
$Build = "$Native\build-win"
$Stage = "$Native\dist-win\MD CAD AI STUDIO"

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
# customer build: licence enforcement ON (the installer's app starts locked until a key for the PC is activated)
cmake -S $Native -B $Build -G Ninja -DCMAKE_BUILD_TYPE=Release `
  "-DCMAKE_PREFIX_PATH=$QtDir;$VcpkgPrefix" -DTHCAD_BUILD_TESTS=ON -DTHCAD_LICENSE_ENFORCE=ON; Check "cmake configure"
cmake --build $Build; Check "cmake build"
# QA variant (licence OFF) for the in-app self-test only — built in its own dir and NEVER staged or packaged
if ($QaBuild) {
  cmake -S $Native -B "$Native\build-win-qa" -G Ninja -DCMAKE_BUILD_TYPE=Release `
    "-DCMAKE_PREFIX_PATH=$QtDir;$VcpkgPrefix" -DTHCAD_BUILD_TESTS=OFF -DTHCAD_LICENSE_ENFORCE=OFF; Check "cmake configure (QA)"
  cmake --build "$Native\build-win-qa" --target THAICADStudio; Check "cmake build (QA)"
}
# the test executables load the OCCT / llama.cpp / Qt DLLs from vcpkg and Qt
$env:PATH = "$VcpkgPrefix\bin;$QtDir\bin;$env:PATH"
ctest --test-dir $Build --output-on-failure; Check "ctest"

# 5) Stage: exe + Qt runtime (windeployqt) + OCCT/llama DLLs + ggml backends + UI
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Stage | Out-Null
Copy-Item "$Build\app\MD CAD AI STUDIO.exe" $Stage
Copy-Item -Recurse "$Build\app\ui" "$Stage\ui"
# Blender render worker script (the user's own Blender runs it; Blender itself is not bundled)
New-Item -ItemType Directory -Force "$Stage\resources" | Out-Null
Copy-Item "$Native\app\resources\md_render.py" "$Stage\resources\md_render.py"
Write-Host "== Stage (windeployqt)"
& "$QtDir\bin\windeployqt.exe" --release --no-translations --no-system-d3d-compiler --no-opengl-sw "$Stage\MD CAD AI STUDIO.exe"; Check "windeployqt"
Copy-Item "$VcpkgPrefix\bin\*.dll" $Stage
New-Item -ItemType Directory -Force "$Stage\ggml" | Out-Null
Get-ChildItem "$VcpkgPrefix\bin\ggml-*.dll" -ErrorAction SilentlyContinue | Copy-Item -Destination "$Stage\ggml"

# 5b) DWG reader: LibreDWG dwg2dxf as a separate GPL-3.0 program (child process, never linked),
#     with its license and the complete source of the shipped version (third_party/libredwg/README.md)
Write-Host "== DWG reader (LibreDWG)"
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
Write-Host "   downloaded"
Expand-Archive $Zip -DestinationPath $Tmp
New-Item -ItemType Directory -Force "$Stage\libredwg", "$Stage\licenses\libredwg" | Out-Null
# imports checked: dwg2dxf.exe -> libredwg-0.dll -> libiconv-2.dll (+ KERNEL32, msvcrt)
foreach ($f in "dwg2dxf.exe", "libredwg-0.dll", "libiconv-2.dll") { Copy-Item "$Tmp\$f" "$Stage\libredwg\" }
# DWG writer (dwgadd ships in the release's examples folder)
Copy-Item "$Tmp\examples\dwgadd.exe" "$Stage\libredwg\"
# DWG with paper-space layouts: dxf2dwg turns the app's DXF R2000 into a DWG
Copy-Item "$Tmp\dxf2dwg.exe" "$Stage\libredwg\"
Copy-Item $Src "$Stage\licenses\libredwg\"
# COPYING from the source tarball via Python's tarfile: Git's GNU tar reads "D:\..." as a remote host and
# Windows bsdtar has no built-in xz (it pipes through an external xz) — both hung the CI job
python -c "import sys, tarfile; t = tarfile.open(sys.argv[1], 'r:xz'); open(sys.argv[2], 'wb').write(t.extractfile('libredwg-0.14.8601/COPYING').read())" $Src "$Stage\licenses\libredwg\COPYING"; Check "extract COPYING"
Write-Host "   license staged"
Copy-Item "$Native\third_party\libredwg\README.md" "$Stage\licenses\libredwg\"
Copy-Item "$Native\..\THIRD_PARTY_NOTICES.md" "$Stage\licenses\"
# smoke-run with a hard timeout so a loader problem fails the build instead of hanging it
$P = Start-Process -FilePath "$Stage\libredwg\dwg2dxf.exe" -ArgumentList "--version" -NoNewWindow -PassThru -RedirectStandardOutput "$Build\dwg2dxf-version.txt"
if (-not $P.WaitForExit(60000)) { $P.Kill(); throw "dwg2dxf --version timed out" }
if ($P.ExitCode -ne 0) { throw "dwg2dxf --version failed (exit $($P.ExitCode))" }
Get-Content "$Build\dwg2dxf-version.txt" | Write-Host
$P = Start-Process -FilePath "$Stage\libredwg\dxf2dwg.exe" -ArgumentList "--version" -NoNewWindow -PassThru -RedirectStandardOutput "$Build\dxf2dwg-version.txt"
if (-not $P.WaitForExit(60000)) { $P.Kill(); throw "dxf2dwg --version timed out" }
if ($P.ExitCode -ne 0) { throw "dxf2dwg --version failed (exit $($P.ExitCode))" }

# 5c) Voice CAD: whisper.cpp whisper-cli (MIT) as a separate program in whisper\ with its own ggml DLLs
#     (kept apart from llama.cpp's ggml next to the exe); see third_party/whisper/README.md.
#     Built from the pinned source with the Vulkan backend (GPU of any vendor: NVIDIA, AMD, Intel incl.
#     integrated) and every CPU variant, loaded at run time: a PC without a Vulkan driver falls back to CPU.
#     Vulkan headers / loader / glslc come from vcpkg (ggml[vulkan] in vcpkg.json).
Write-Host "== Speech recognition (whisper.cpp, Vulkan + CPU)"
$WSrc = Fetch "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz" "57E280CEE375AB02425B806AD5146B99F6EB9357E3C2B31357C8A6AF2E2E44AE"
$WTmp = "$Build\whisper"
Remove-Item -Recurse -Force $WTmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $WTmp | Out-Null
python -c "import sys, tarfile; tarfile.open(sys.argv[1], 'r:gz').extractall(sys.argv[2])" $WSrc $WTmp; Check "whisper source"
$Glslc = Get-ChildItem -Recurse "$Build\vcpkg" -Filter glslc.exe | Select-Object -First 1
if (-not $Glslc) { throw "glslc.exe (vcpkg shaderc) not found" }
cmake -S "$WTmp\whisper.cpp-1.9.4" -B "$WTmp\build" -G Ninja -DCMAKE_BUILD_TYPE=Release `
  -DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON -DGGML_NATIVE=OFF -DGGML_VULKAN=ON `
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF `
  "-DCMAKE_PREFIX_PATH=$VcpkgPrefix" "-DVulkan_INCLUDE_DIR=$VcpkgPrefix\include" "-DVulkan_LIBRARY=$VcpkgPrefix\lib\vulkan-1.lib" `
  "-DVulkan_GLSLC_EXECUTABLE=$($Glslc.FullName)"; Check "whisper configure"
cmake --build "$WTmp\build"; Check "whisper build"
New-Item -ItemType Directory -Force "$Stage\whisper", "$Stage\licenses\whisper" | Out-Null
Copy-Item "$WTmp\build\bin\whisper-cli.exe" "$Stage\whisper\"
Get-ChildItem "$WTmp\build\bin\*.dll" | Copy-Item -Destination "$Stage\whisper\"
Get-ChildItem "$Stage\whisper" | ForEach-Object { Write-Host "   $($_.Name)" }
if (-not (Test-Path "$Stage\whisper\ggml-vulkan.dll")) { throw "ggml-vulkan.dll was not built" }
Copy-Item "$WTmp\whisper.cpp-1.9.4\LICENSE" "$Stage\licenses\whisper\LICENSE"
Copy-Item "$Native\third_party\whisper\README.md" "$Stage\licenses\whisper\"
$P = Start-Process -FilePath "$Stage\whisper\whisper-cli.exe" -ArgumentList "--help" -NoNewWindow -PassThru -RedirectStandardOutput "$Build\whisper-help.txt" -RedirectStandardError "$Build\whisper-help-err.txt"
if (-not $P.WaitForExit(60000)) { $P.Kill(); throw "whisper-cli --help timed out" }
if ($P.ExitCode -ne 0) { throw "whisper-cli --help failed (exit $($P.ExitCode))" }
Write-Host "   whisper-cli runs"
# a real transcription with the tiny model (the runner has no GPU: this checks the CPU fallback and the
# backend loading; the log names the device used)
$Tiny = Fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin" "BE07E048E1E599AD46341C8D2A135645097A538221678B7ACDD1B1919C6E1B21"
$P = Start-Process -FilePath "$Stage\whisper\whisper-cli.exe" -ArgumentList "-m `"$Tiny`" -l vi -nt -f `"$Native\..\qa\fixtures\voice\vi_window_SYNTHETIC.wav`"" -NoNewWindow -PassThru -RedirectStandardOutput "$Build\whisper-out.txt" -RedirectStandardError "$Build\whisper-log.txt"
if (-not $P.WaitForExit(300000)) { $P.Kill(); throw "whisper-cli transcription timed out" }
Get-Content "$Build\whisper-log.txt" | Select-String -Pattern "backend|vulkan|load_backend|CPU" | ForEach-Object { Write-Host "   $_" }
$Said = (Get-Content "$Build\whisper-out.txt" -Raw)
Write-Host "   transcript (tiny model): $Said"
if ($P.ExitCode -ne 0 -or -not $Said.Trim()) { throw "whisper-cli transcription failed (exit $($P.ExitCode))" }

# 5d) guard: the staged app must be licence-enforced and start locked on a PC without a key
$P = Start-Process -FilePath "$Stage\MD CAD AI STUDIO.exe" -ArgumentList "--licence-info" -NoNewWindow -PassThru -RedirectStandardOutput "$Build\licence-info.txt"
if (-not $P.WaitForExit(60000)) { $P.Kill(); throw "--licence-info timed out" }
$Lic = (Get-Content "$Build\licence-info.txt" -Raw)
Write-Host "   licence: $Lic"
if ($Lic -notmatch "enforce=1") { throw "the staged app is not licence-enforced: refusing to package it" }
if ($Lic -notmatch "licensed=0") { throw "the staged app reports a licence on the build machine (unexpected)" }

# 6) Optional signing, then the installer
Write-Host "== Installer (Inno Setup)"
if ($SignCmd) { Invoke-Expression "$SignCmd `"$Stage\MD CAD AI STUDIO.exe`"" }
$Version = (Select-String -Path "$Native\CMakeLists.txt" -Pattern 'VERSION (\d+\.\d+\.\d+)').Matches[0].Groups[1].Value
iscc "/DAppVersion=$Version" "/DStageDir=$Stage" "/O$Native\dist-win" "$PSScriptRoot\installer.iss"; Check "iscc"
$Setup = "$Native\dist-win\MD-CAD-AI-STUDIO-Setup-$Version.exe"
if ($SignCmd) { Invoke-Expression "$SignCmd `"$Setup`"" }
Write-Host "Installer: $Setup"
