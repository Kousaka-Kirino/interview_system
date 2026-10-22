# Stage 13 · 全新电脑 SQLite 建库与本地注册修复包

**针对 2026-10-22 用户上传的完整 `interview_system-main` 源码。**

修复三处：`main.py` 没有创建认证表；`stage8b_auth.py` 登录/注册要求数据库已存在；`stage11_local.py` 错误要求纯新安装必须有旧 `aslan`。新增 `stage13_bootstrap.py`，在启动时创建空白认证表但**不创建任何用户**，并为新注册账号正确分配独立用户空间。

本包修改 `backend/app/main.py`、`backend/app/stage11_local.py`，新增 `backend/app/stage13_bootstrap.py`、`backend/tests/test_stage13_bootstrap.py` 和 `docs/STAGE13_FRESH_INSTALL.md`。**不修改前端，不修改现有接口，不复制/打包/覆盖用户数据库。**

## Windows PowerShell 一键安装

先停止 FastAPI。把 ZIP 放到 `Downloads`，在项目根目录的任意 PowerShell 执行（按需改你的项目路径）：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$zip = Join-Path $HOME 'Downloads\stage13_first_run_db_fix.zip'
$unpack = Join-Path $project 'stage13_import'
if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "未找到安装包：$zip" }
New-Item -ItemType Directory -Force -Path $unpack | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& (Join-Path $unpack 'install-stage13.ps1') -ProjectRoot $project -DryRun
& (Join-Path $unpack 'install-stage13.ps1') -ProjectRoot $project
```

`-DryRun` 只预览，不修改文件。正式安装会对**存在的认证 SQLite**做一致性快照并备份修改前源码，然后验证新的首机注册流程。旧源码 SHA-256 不一致时会**拒绝覆盖**，请上传最新版本重新制包，勿跳过检查。

## 启动与注册

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
$env:HF_HUB_OFFLINE = '1'         # 模型已经下载好时使用
$env:TRANSFORMERS_OFFLINE = '1'
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

另外开一个终端到 `frontend` 执行 `npm.cmd run dev`；前端登录页点「在本机注册」。**新安装没有默认账号，也不需要复制其他电脑的 interview.db。** 原 `aslan` 历史账户如果存在，会原样保留。

安装后预期输出：`[Stage 13] SUCCESS.`；后端首次启动预期输出：`[Stage 13] Local authentication tables ready. No default account created.`。

修复原理、数据库安全兼容检查和排错详见 `patches/docs/STAGE13_FRESH_INSTALL.md`（安装后位于项目的 `docs/`）。
