[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [switch]$SkipBuild
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# PowerShell 5.1 compatible: installer source is ASCII only.
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\','/'))
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
$rollback = Join-Path $package 'restore-stage10.ps1'
$utf8Strict = New-Object System.Text.UTF8Encoding($false,$true)
$utf8Writer = New-Object System.Text.UTF8Encoding($false)
function RequireFile([string]$path) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" } }
function ReadUtf8([string]$path) { return [IO.File]::ReadAllText($path,$utf8Strict) }
function WriteUtf8([string]$path,[string]$value) {
  $folder = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $folder -PathType Container)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
  [IO.File]::WriteAllText($path,$value,$utf8Writer)
}
function PortOpen([int]$port) {
  $socket = New-Object System.Net.Sockets.TcpClient
  try {
    $res = $socket.BeginConnect('127.0.0.1',$port,$null,$null)
    return ($res.AsyncWaitHandle.WaitOne(400) -and $socket.Connected)
  } catch { return $false } finally { $socket.Close() }
}
$tracked = @(
  'backend/app/main.py',
  'frontend/src/lib/api.ts',
  'frontend/src/pages/MaterialsPage.tsx',
  'backend/app/stage10_pptx.py',
  'PROJECT_GUIDE.md',
  'API_DOCUMENTATION.md'
)
$docs = @(
  @{dest='PROJECT_GUIDE.md';append='docs/PROJECT_GUIDE_STAGE10_APPEND.md';title='# PROJECT_GUIDE'},
  @{dest='API_DOCUMENTATION.md';append='docs/API_DOCUMENTATION_STAGE10_APPEND.md';title='# API_DOCUMENTATION'}
)
Write-Host '[Stage 10] Checking local project...' -ForegroundColor Cyan
foreach ($path in @(
  $python, $rollback,
  (Join-Path $project 'frontend\package.json'),
  (Join-Path $project 'backend\app\stage8b_auth.py'),
  (Join-Path $package 'backend\app\stage10_pptx.py'),
  (Join-Path $package 'stage10_patch.py'),
  (Join-Path $package 'tests\test_stage10_pptx.py')
)) { RequireFile $path }
foreach ($rel in $tracked[0..2]) { RequireFile (Join-Path $project ($rel.Replace('/','\'))) }
foreach ($doc in $docs) { RequireFile (Join-Path $package ($doc.append.Replace('/','\'))) }
if (Test-Path -LiteralPath (Join-Path $project 'backend\app\stage10_pptx.py')) {
  throw 'PPTX module already exists. Installation stopped to avoid overwriting unknown code.'
}
if (PortOpen 8000) { throw 'FastAPI is running on 8000. Stop it before installing (Ctrl+C).' }
if (-not $SkipBuild -and -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd not found. Install Node.js first.' }
& $python -c 'import fastapi, docx, httpx; print("[Stage 10] Python dependencies available")'
if ($LASTEXITCODE -ne 0) { throw 'Missing backend dependencies. Install backend/requirements.txt in your project venv.' }
& $python (Join-Path $package 'stage10_patch.py') --project-root $project --check
if ($LASTEXITCODE -ne 0) { throw 'Source preflight failed. No files changed. Check installer error above.' }
foreach ($rel in $tracked) {
  $target = Join-Path $project ($rel.Replace('/','\'))
  if (Test-Path -LiteralPath $target -PathType Container) { throw "Target is a directory: $rel" }
}
$parent = Split-Path -Parent $project
$leaf = Split-Path -Leaf $project
$backup = Join-Path $parent ($leaf + '_stage10_backup_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
$files = @()
foreach ($rel in $tracked) {
  $target = Join-Path $project ($rel.Replace('/','\'))
  $present = Test-Path -LiteralPath $target -PathType Leaf
  $files += [pscustomobject]@{path=$rel;existed=[bool]$present}
  if ($present) {
    $dest = Join-Path $backup ($rel.Replace('/','\'))
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath $target -Destination $dest -Force -ErrorAction Stop
  }
}
[pscustomobject]@{stage='10-pptx';project_root=$project;files=$files} | ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath (Join-Path $backup 'manifest.json') -Encoding UTF8
Write-Host "[Stage 10] Backup: $backup" -ForegroundColor Yellow
try {
  $moduleTarget = Join-Path $project 'backend\app\stage10_pptx.py'
  Copy-Item -LiteralPath (Join-Path $package 'backend\app\stage10_pptx.py') -Destination $moduleTarget -ErrorAction Stop
  & $python (Join-Path $package 'stage10_patch.py') --project-root $project --apply
  if ($LASTEXITCODE -ne 0) { throw 'Applying frontend/backend integration failed.' }
  foreach ($doc in $docs) {
    $dest = Join-Path $project $doc.dest
    $content = if (Test-Path -LiteralPath $dest -PathType Leaf) { ReadUtf8 $dest } else { $doc.title }
    if (-not $content.Contains('<!-- STAGE10_PPTX_BEGIN -->')) {
      $append = ReadUtf8 (Join-Path $package ($doc.append.Replace('/','\')))
      WriteUtf8 $dest ($content.TrimEnd() + "`r`n`r`n" + $append.Trim() + "`r`n")
    }
  }
  & $python -m py_compile $moduleTarget (Join-Path $project 'backend\app\main.py')
  if ($LASTEXITCODE -ne 0) { throw 'Python syntax check failed.' }
  & $python (Join-Path $package 'tests\test_stage10_pptx.py') (Join-Path $project 'backend')
  if ($LASTEXITCODE -ne 0) { throw 'PPTX API tests failed.' }
  if (-not $SkipBuild) {
    Push-Location (Join-Path $project 'frontend')
    try {
      & npm.cmd run build
      if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
  }
  WriteUtf8 (Join-Path $package 'LAST_BACKUP_STAGE10.txt') $backup
  Write-Host '[Stage 10] SUCCESS. Restart FastAPI; refresh frontend.' -ForegroundColor Green
  Write-Host '[Stage 10] NOTE: PPTX is indexed as a DOCX text derivative; original PPTX is not retained.' -ForegroundColor Yellow
} catch {
  $why = $_.Exception.Message
  Write-Warning "[Stage 10] Failure: $why"
  try { & $rollback -ProjectRoot $project -BackupDir $backup }
  catch { Write-Warning "Rollback also failed, use backup: $backup" }
  throw "Stage 10 installation failed: $why"
}
