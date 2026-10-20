# Stage 10B — PPTX 上传 404 修复包（Windows）

## 解决的问题

Stage 10 已安装并通过构建，但上传 PPTX 时，FastAPI 打印：

```text
POST /api/materials/pptx-import HTTP/1.1" 404 Not Found
```

这表示上传**接口地址**不存在或未注册，不是本地 PPTX 文件路径错误。

Stage 10B 将原有 PPTX 上传接口从 `POST /api/materials/pptx-import` 更改为 **`POST /api/pptx-import`**，并同时更改前端发起请求的地址。其余 Stage 10 的认证、文字提取、DOCX 转换和索引逻辑保持不变。

## 安装前

1. 请确保 **已经安装 Stage 10**，且没有手动移动或重命名 PPTX 上传代码。
2. 关闭运行中的 **FastAPI**（按 `Ctrl+C`）；Vite 可以保持运行。
3. 使用原先的工程目录。安装器不会猜测或复制不同目录的程序。
4. ZIP 解压至任意临时目录。不要把脚本中的示例路径理解成固定路径。

## 一键安装

在 PowerShell 中（修改 `$project` 为你的实际工程根目录）：

```powershell
$project = 'C:\path\to\interview_system'
$zip = Join-Path $HOME 'Downloads\stage10b_pptx_fix_release_REBUILT.zip'
$unpack = Join-Path $project 'stage10b_import'
if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "ZIP 不存在：$zip" }
New-Item -ItemType Directory -Path $unpack -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& (Join-Path $unpack 'install-stage10b.ps1') -ProjectRoot $project
```

成功输出包括：

```text
[CHECK] POST /api/pptx-import registered: True
[Stage 10B] SUCCESS. Stop and restart FastAPI; refresh Vite/browser.
```

安装器会执行：源码兼容检查 -> 建立带时间戳的备份 -> 修改路由 -> 检查实际 FastAPI 路由表 -> 前端 `npm.cmd run build`。任何检查失败会自动恢复已修改文件。

**注意：** 脚本只做已有 Stage 10 路由地址替换。如果无法在后端和前端找到旧地址或已修复的新地址，则**拒绝修改**；不会凭空创建可能绕开原身份验证的新端点。

## 完成后

在工程 `backend` 目录启动原来的 FastAPI，然后刷新浏览器（推荐 `Ctrl+Shift+R`），再次上传 `.pptx`：

```powershell
$project = 'C:\path\to\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

FastAPI 若已使用 `--reload`，仍建议先停止并重启，以确认加载的是更新后的源代码。

## 手动回滚

安装日志会显示实际备份目录；复制那个路径，再执行：

```powershell
$project = 'C:\path\to\interview_system'
$backup = 'C:\path\to\interview_system_stage10b_backup_XXXXXXXX'
& 'C:\path\to\unpacked\stage10b\rollback-stage10b.ps1' -ProjectRoot $project -BackupDir $backup
```

若文件在安装后被再次人工编辑，回滚默认拒绝覆盖；请先备份新改动，再考虑传入 `-Force`。

## 常见问题

- **404 仍存在：** 看 FastAPI 请求日志是旧 `/api/materials/pptx-import` 还是新 `/api/pptx-import`。前者说明浏览器/Vite 仍在加载旧前端代码；后者说明实际后端路由仍未注册，需要检查 `app.main` 启动模块与安装日志。
- **ECONNREFUSED：** FastAPI 8000 端口未启动。
- **ECONNRESET：** 连接被中断，通常需要检查 FastAPI 的异常 traceback 或运行状态；它本身不能证明文件路径错误。
- **401/403：** 请先正常登录。
- **413/422：** 文件大小、格式或上传字段校验问题。
- **`No module named ...`：** 安装器选择到的 Python 环境缺少项目依赖，需要核实虚拟环境。

## 修改范围

仅替换已存在的 PPTX 地址常量（后端 `backend/app/**/*.py`，前端 `frontend/src/**/*.{ts,tsx}`）并在已有 `PROJECT_GUIDE.md` 和 `API_DOCUMENTATION.md` 附加 Stage 10B 更新说明。**不修改账号逻辑、不创建 DB 迁移、不新增 Python 依赖、不更改 Ollama 配置。**
