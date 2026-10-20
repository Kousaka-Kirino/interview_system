param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [Parameter(Mandatory=$true)][string]$BackupDir,
    [switch]$Force
)
$ErrorActionPreference='Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$script = Join-Path $PSScriptRoot 'scripts\stage10b_patch.py'
$pythonCandidates = @(
    (Join-Path $project '.venvs\interview_system\Scripts\python.exe'),
    (Join-Path $project '.venv\Scripts\python.exe'),
    (Join-Path $project 'backend\.venv\Scripts\python.exe')
)
$python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $python) { throw 'Project virtualenv python.exe not found' }
$argsList = @($script, '--project', $project, '--rollback', $BackupDir)
if ($Force) { $argsList += '--force' }
& $python @argsList
if ($LASTEXITCODE -ne 0) { throw "Rollback failed (exit $LASTEXITCODE)." }
