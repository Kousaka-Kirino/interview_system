[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [Parameter(Mandatory=$true)][string]$BackupDir
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$project = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\','/'))
$backup = [IO.Path]::GetFullPath($BackupDir).TrimEnd([char[]]@('\','/'))
$manifestFile = Join-Path $backup 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw 'Missing backup manifest.' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.stage -ne '10-pptx' -or $manifest.project_root -ne $project) { throw 'Backup does not belong to this project.' }
$allowed = @('backend/app/main.py','frontend/src/lib/api.ts','frontend/src/pages/MaterialsPage.tsx','backend/app/stage10_pptx.py','PROJECT_GUIDE.md','API_DOCUMENTATION.md')
foreach ($entry in @($manifest.files)) {
  $rel = [string]$entry.path
  if ($allowed -notcontains $rel) { throw "Unsafe or unexpected backup path: $rel" }
  $target = Join-Path $project ($rel.Replace('/','\'))
  if ([bool]$entry.existed) {
    $source = Join-Path $backup ($rel.Replace('/','\'))
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Backup copy missing: $rel" }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force -ErrorAction Stop
  } else {
    if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force -ErrorAction Stop }
  }
}
Write-Host '[Stage 10] Tracked files restored. Business data was not modified.' -ForegroundColor Green
