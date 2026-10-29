# AI 答辩训练系统 · Windows 安装与维护手册

**适用基线：Stage 24A（含 PPT 翻页修复）｜2026-10-29**

本文面向 Windows 10/11 的本地用户。系统使用 React / Vite 前端、FastAPI 后端、SQLite（账号与个人业务数据）、Chroma 中文资料索引。不同版本的运行环境可能存在差异；请以实际构建和日志为准。

## 1. 安装前确认

- 建议 Python **3.12（64 位）**、Node.js **22.12+** 与 npm；PowerShell、Edge/Chrome。建议 8 GB 或以上内存，并留足模型和 npm 依赖空间。
- 使用 DeepSeek 时需要自行申请 API Key、联网并承担模型费用；使用 Ollama 时需要已安装并启动本地模型服务。
- 显示 PPT 原始版式需要电脑上可调用的 **Microsoft PowerPoint 或 LibreOffice**。没有转换器时仍可显示幻灯片文字并翻页，不能保留原布局、图片或图表。
- 音频转写可选；Whisper 模型首次使用需要下载。文字输入、自我陈述不依赖麦克风。
- 不把 `.env`、`storage/`、账号数据库、简历或 PPT 提交到公开仓库。

## 2. 项目路径与环境检查

本机示例路径（仅用于命令；其他电脑需要自行调整）：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
Set-Location $project
Test-Path '.\backend\app\main.py'
Test-Path '.\frontend\package.json'
py -3.12 --version
node --version
npm.cmd --version
```

两个 `Test-Path` 应返回 `True`。新开 PowerShell 窗口后需要重新设置 `$project`。

## 3. 后端依赖和前端安装

```powershell
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
if (-not (Test-Path $python)) {
    py -3.12 -m venv (Join-Path $project '.venvs\interview_system')
}
& $python -m pip install -r (Join-Path $project 'backend\requirements.txt')
Set-Location (Join-Path $project 'frontend')
npm.cmd ci
npm.cmd run test:ui
npm.cmd run build
```

`npm.cmd ci` 要求 `package-lock.json` 与 `package.json` 一致，不要随意删除锁文件。可选语音组件：

```powershell
& $python -m pip install 'faster-whisper==1.2.1'
& $python -m pip check
```

已知部分 `faster-whisper==1.2.1` 环境会与较新 PyAV 发生 `metadata_errors` 参数不兼容。先检查版本、保存原始报错；如出现此特定异常，可在**停止后端**后使用已测试的兼容版本 `av==17.1.0`，然后重新跑语音测试。具体以本机依赖解析和测试结果为准；不建议为修语音而删除业务数据库。

## 4. 配置模型服务

项目根目录 `.env` 由 `backend/app/core/config.py` 读取。只编辑已有文件中需要变动的项目；不要把密钥硬编码进源码或脚本，也不要发到聊天或 Git。

**方案 A：本机 Ollama**（示例模型需已执行 `ollama pull`）：

```dotenv
DEEPSEEK_API_KEY=ollama
DEEPSEEK_BASE_URL=http://127.0.0.1:11434/v1
DEEPSEEK_MODEL=qwen2.5:1.5b
SQLITE_PATH=storage/data/interview.db
CHROMA_PATH=storage/chroma
UPLOAD_PATH=storage/uploads
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

**方案 B：DeepSeek 云端**：`DEEPSEEK_BASE_URL=https://api.deepseek.com`，`DEEPSEEK_API_KEY` 写入你自己的有效新密钥，`DEEPSEEK_MODEL` 以你的 API 账户当前支持的模型 ID 为准（不要仅凭历史示例假设模型长期可用）。云端会处理答辩上下文文本；演示 PPT 原文件用于本地渲染，不会因本地翻页自动发给云端。主动使用 AI 分析时可能发送选定的提取文字并产生费用。

## 5. 中文资料索引

上传资料使用本地 `BAAI/bge-small-zh-v1.5` 生成向量索引，首次运行前建议联网验证：

```powershell
Set-Location $project
& $python -c "from sentence_transformers import SentenceTransformer; m=SentenceTransformer('BAAI/bge-small-zh-v1.5'); print(len(m.encode('毕业设计答辩')))"
```

通常输出向量长度 512。只有在模型已经完整下载并验证可离线加载的情况下，才在**启动后端的当前终端**设置：

```powershell
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
```

不要在第一次下载前开启离线模式。Hugging Face 的 Windows symlink 缓存警告一般不是致命异常，但可能增加磁盘占用。

## 6. 首次建库与启动

Stage 13 以后，后端启动先运行 `initialize_account_database()`，再运行 `init_db()`。全新空白环境创建账号认证表，不创建默认账户。旧库有历史数据时不要强制迁移或删除 `storage/`。

PowerShell 窗口 A（FastAPI）：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

PowerShell 窗口 B（Vite）：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
Set-Location (Join-Path $project 'frontend')
npm.cmd run dev
```

浏览器打开 **http://127.0.0.1:5173/**，首次自行注册。用户名为 3–32 位小写英文、数字或下划线（保留用户名不可注册）；密码至少 12 字符。`/api/health` 在未登录时可能返回 401，不可单凭此判定后端故障。

## 7. 数据、备份和升级

- 集中账号数据库：`storage/data/interview.db`；新账号业务数据：`storage/users/<用户UUID>/interview.db`、`uploads/` 与 `chroma/`。实际目录受 `.env` 及项目账号隔离逻辑影响。
- 修改代码或升级前停止后端与前端，备份整个 `storage/`，再备份 `.env` 到安全地点；**绝不**把真实密钥打进补丁或上传公开仓库。
- 逐组补丁必须先 `-DryRun`，确认兼容后正式安装。安装器在 `_patch_backups` 保存变更前源码，遇到无法合并的本地修改应停止而非强制覆盖。
- 退出服务在对应 PowerShell 按 `Ctrl+C`；不会因此清空用户答辩记录。

## 8. 集成验收与故障定位

```powershell
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_group11_local_presentation.py tests/test_group10_practice_modes.py tests/test_group9_training_loop.py tests/test_ai_review_group8.py tests/test_resume_corrections_group2.py tests/test_document_preview_group3.py tests/test_dashboard_score_history_group6.py tests/test_group12_cleanup.py
Set-Location (Join-Path $project 'frontend')
npm.cmd run test:ui
npm.cmd run build
```

- 浏览器与 FastAPI 连不上：检查 `127.0.0.1:8000` 是否运行，查看 Vite 代理和后端终端日志。
- PPTX 转文字卡住：检查 BGE 模型与索引；PPTX 需要可提取文字，非 OCR。
- PPT 只显示 `1 / 1`：检查实际上传页数；旧版仅存 DOCX 的资料可能只有文字版，无法恢复原始幻灯片。
- PPT 可以翻页但看不到原版：需要 PowerPoint / LibreOffice，本机渲染失败可降级文字展示。
- 语音失败：先找后端 `Speech transcription failed` traceback，检查 PyAV / faster-whisper 兼容和麦克风输入电平。不要将 Hugging Face symlink 警告误判为转写根因。
- DeepSeek 调用失败：检查 API Key、模型 ID、网络、余额和终端错误，不要将 Key 粘贴到日志或聊天里。

## 9. 当前边界

本系统优先保证本机登录与业务数据隔离；PPT 展示可本地渲染，但 AI 逐页体检只分析文字，不理解图像、柱状图视觉细节。浏览器翻页不调用模型；开始答辩、逐页 AI 体检、陈述分析及复盘可能触发模型调用。真实 Windows 部署与云端计费应分别验收。
