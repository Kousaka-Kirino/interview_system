param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$script = Join-Path $PSScriptRoot 'scripts\stage10b_patch.py'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Missing scripts\stage10b_patch.py' }
if (-not (Test-Path -LiteralPath (Join-Path $project 'frontend\package.json') -PathType Leaf)) { throw 'Wrong project folder: frontend\package.json missing' }
$pythonCandidates = @(
    (Join-Path $project '.venvs\interview_system\Scripts\python.exe'),
    (Join-Path $project '.venv\Scripts\python.exe'),
    (Join-Path $project 'backend\.venv\Scripts\python.exe')
)
$python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $python) { throw 'Project virtualenv python.exe not found; check .venvs\interview_system or .venv.' }
Write-Host "[Stage 10B] Project: $project"
Write-Host "[Stage 10B] Python:  $python"
& $python $script --project $project --python $python --npm npm.cmd
if ($LASTEXITCODE -ne 0) { throw "Stage 10B failed (exit $LASTEXITCODE). If any files were edited, automatic rollback was attempted." }
