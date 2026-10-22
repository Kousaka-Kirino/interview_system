[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
$py = Join-Path $root '.venvs\interview_system\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $py -PathType Leaf)) {
    $py = Join-Path $root '.venv\Scripts\python.exe'
}
if (-not (Test-Path -LiteralPath $py -PathType Leaf)) {
    throw '未找到 Python 虚拟环境：请先创建 .venvs\interview_system 或 .venv 并安装 backend/requirements.txt。'
}
$script = Join-Path $PSScriptRoot 'tools\stage13_installer.py'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "修复包不完整：$script"
}
$arguments = @($script, '--project-root', $root, '--python', $py)
if ($DryRun) { $arguments += '--dry-run' }
& $py @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Stage 13 安装/验证失败（退出码 $LASTEXITCODE），请查看上方日志；失败时会尝试自动回滚源码。"
}
