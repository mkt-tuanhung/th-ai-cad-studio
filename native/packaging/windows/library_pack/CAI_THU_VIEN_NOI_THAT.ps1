# MD CAD AI STUDIO - cai thu vien noi that 3D (Poly Haven CC0) vao may, khong can Internet.
# Gop vao thu vien san co: KHONG xoa / ghi de do khach da tu them (origin user-*), chi them muc chua co.
$ErrorActionPreference = "Stop"
$Src = Join-Path $PSScriptRoot "library"
$Dst = if ($env:MDCAD_LIBRARY_DEST) { $env:MDCAD_LIBRARY_DEST } else { Join-Path $env:LOCALAPPDATA "MD CAD AI STUDIO\library" }  # MDCAD_LIBRARY_DEST: CI test only
if (-not (Test-Path (Join-Path $Src "library.json"))) { throw "Khong thay library\library.json canh tep nay" }
New-Item -ItemType Directory -Force $Dst | Out-Null
Write-Host "Chep thu vien vao: $Dst"
# /XC /XN /XO: bo qua file da co (khong ghi de); /E: ca thu muc con
robocopy $Src $Dst /E /XC /XN /XO /XF library.json /NFL /NDL /NJH /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy loi (ma $LASTEXITCODE)" }
$pack = Get-Content (Join-Path $Src "library.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$manifestPath = Join-Path $Dst "library.json"
if (Test-Path $manifestPath) {
  $cur = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $have = @{}; foreach ($i in $cur.items) { $have[$i.id] = $true }
  $added = 0
  $items = [System.Collections.ArrayList]@($cur.items)
  foreach ($i in $pack.items) { if (-not $have.ContainsKey($i.id)) { [void]$items.Add($i); $added++ } }
  $cur.items = $items
  Copy-Item $manifestPath "$manifestPath.bak" -Force
  $json = $cur | ConvertTo-Json -Depth 20
} else {
  $added = $pack.items.Count
  $json = $pack | ConvertTo-Json -Depth 20
}
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Xong: them $added muc vao thu vien. Mo lai MD CAD AI STUDIO de dung."
