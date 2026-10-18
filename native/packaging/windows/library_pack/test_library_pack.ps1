# CI test of the offline library pack: merge into an existing library keeps the user's own items.
$ErrorActionPreference = "Stop"
$T = Join-Path $env:RUNNER_TEMP "libpack"
Remove-Item -Recurse -Force $T -ErrorAction SilentlyContinue
$Pack = Join-Path $T "pack"; $Dest = Join-Path $T "dest"
New-Item -ItemType Directory -Force "$Pack\library\models\sofa_02", "$Pack\library\hdri", "$Dest\user\my_chair" | Out-Null
Set-Content "$Pack\library\models\sofa_02\sofa_02_2k.gltf" "{}"
Set-Content "$Pack\library\hdri\garden.hdr" "x"
$packJson = '{"version":1,"items":[{"id":"sofa_02","kind":"model","name":"Sofa 02","nameVi":"Sofa văng","dir":"models/sofa_02","files":{"main":"sofa_02_2k.gltf"},"origin":"builtin-download"},{"id":"garden","kind":"hdri","name":"Garden","dir":"hdri","files":{"main":"garden.hdr"},"origin":"builtin-download"}]}'
[System.IO.File]::WriteAllText("$Pack\library\library.json", $packJson, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item "$PSScriptRoot\CAI_THU_VIEN_NOI_THAT.ps1" $Pack
Set-Content "$Dest\user\my_chair\model.glb" "glb"
$userJson = '{"version":1,"items":[{"id":"my_chair","kind":"model","name":"Ghế của tôi","dir":"user/my_chair","files":{"main":"model.glb"},"origin":"user-import"}]}'
[System.IO.File]::WriteAllText("$Dest\library.json", $userJson, (New-Object System.Text.UTF8Encoding($false)))
$env:MDCAD_LIBRARY_DEST = $Dest
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Pack\CAI_THU_VIEN_NOI_THAT.ps1"
if ($LASTEXITCODE -ne 0) { throw "pack script failed" }
& powershell -NoProfile -ExecutionPolicy Bypass -File "$Pack\CAI_THU_VIEN_NOI_THAT.ps1"   # run twice: idempotent
$m = Get-Content "$Dest\library.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$ids = @($m.items | ForEach-Object { $_.id })
Write-Host "items after merge: $($ids -join ', ')"
if ($ids.Count -ne 3) { throw "expected 3 items, got $($ids.Count)" }
foreach ($id in "my_chair", "sofa_02", "garden") { if ($ids -notcontains $id) { throw "missing $id" } }
if (($m.items | Where-Object { $_.id -eq "my_chair" }).name -ne "Ghế của tôi") { throw "user item changed (Vietnamese name)" }
if (-not (Test-Path "$Dest\models\sofa_02\sofa_02_2k.gltf")) { throw "model files not copied" }
if ((Get-Content "$Dest\user\my_chair\model.glb") -ne "glb") { throw "user file touched" }
Write-Host "library pack merge test OK"
