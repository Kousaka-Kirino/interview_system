param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$project = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
$installer = Join-Path $PSScriptRoot 'stage12_install.py'

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "虚拟环境 Python 不存在：$python"
}
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Stage 12 安装脚本不存在：$installer"
}

$arguments = @($installer, '--project', $project)
if ($DryRun) { $arguments += '--dry-run' }

& $python @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Stage 12 未完成（退出码 $LASTEXITCODE）。请查看上面的检查或回滚日志。"
}
