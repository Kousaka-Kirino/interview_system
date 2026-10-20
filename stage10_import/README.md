# Stage 10：补充资料新增 PPTX 文字检索（Windows 一键安装）

本次升级**支持上传 `.pptx` 课题汇报/毕业设计/论文答辩幻灯片**，从每一页按展示顺序提取文字并建立原有的 Chroma/RAG 索引。适用于已安装登录模块、原补充资料上传与索引能正常使用的 `interview_system`。

## 重要：当前是文字提取版本

- 支持 `.pptx`（PowerPoint 2007+），**不支持老式二进制 `.ppt`**；旧格式需在 PowerPoint 或 LibreOffice 中“另存为 .pptx”。
- 目前**不做图像 OCR，也不理解图片、图表、复杂公式、动画、视频等非文本内容**。只有 PPTX 文本层中的文字会被索引。整份 PPTX 如果没有可提取的文字，会提示改用其他格式或补充讲稿。
- 为复用现有后端的 PDF/DOCX 上传与用户归属逻辑，PPTX 会在请求中转成**带“第 N 页”标题的 DOCX 文字提取版**，由原有接口保存和索引；资料列表展示转换后的 `.docx` 名称。**原始 PPTX 文件本身不在本阶段存储**。如果需要保留完整原件，应另行保存。
- 上传大小最多 12 MiB、150 张幻灯片、可提取文字最多 200,000 字符，解压内容总量限制 100 MiB。
- 无需改 `.env`，无需增加 Python 包或 npm 包，无需重建 SQLite/Chroma，也不改变已有 PDF/DOCX 上传、答辩和知识复习流程。

## 一键安装（请先停止 FastAPI）

请将下载的 `stage10_pptx_release.zip` 放到 Windows 的 `Downloads`。PowerShell 复制执行：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$zip = Join-Path $HOME 'Downloads\stage10_pptx_release.zip'
$unpack = Join-Path $project 'stage10_import'
if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "ZIP not found: $zip" }
if (-not (Test-Path -LiteralPath (Join-Path $project 'frontend\package.json') -PathType Leaf)) { throw "Project not found: $project" }
New-Item -ItemType Directory -Path $unpack -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
$installer = Join-Path $unpack 'install-stage10.ps1'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer not found: $installer" }
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& $installer -ProjectRoot $project
```

脚本检查当前项目必要文件和已有代码的稳定锚点，**有不匹配即在修改之前退出**；并要求 FastAPI 不在 8000 端口运行。通过预检后，在工程同级目录生成唯一备份，更新 3 处现有源码、新增一个后端 PPTX 导入模块、追加两份 Markdown 文档、运行 8 项自动测试和 `npm.cmd run build`。若执行失败，会尝试恢复改动前的 6 个跟踪文件。安装过程**不写数据库**。

## 启动（两个 PowerShell 窗口）

后端：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
$python = (Resolve-Path '.\.venvs\interview_system\Scripts\python.exe').Path
Set-Location '.\backend'
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

前端：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run dev
```

登录后进入 `http://127.0.0.1:5173/#materials` → 选择一份含**可选择文字**的 PPTX → “上传并建立索引” → 在资料列表中出现 `..._PPTX文字提取版.docx` → 选择后通过 RAG 检索。该资料也可在答辩配置页面作为补充资料选择。

## 新接口及兼容关系

| 路径 | 说明 |
|---|---|
| `POST /api/materials/pptx-import` | 认证后的 PPTX 上传，内部转换并复用原 `POST /api/materials` |
| `POST /api/materials` | 既有 PDF/DOCX 上传，没有改变 |
| `GET /api/materials` | 列表，PPTX 文字衍生版显示为 DOCX |
| `POST /api/materials/search` | 原有资料 ID 检索，不变 |
| `DELETE /api/materials/{material_id}` | 原有删除，移除该文字衍生版和索引 |

原 `.pptx` 中的页号按幻灯片排列顺序写入文字副本。检索结果的 chunk_index 不是幻灯片编号。**接口会复用原有用户身份和资料归属权限验证**；脚本不会开放注册，也不修改账号数据。

## 手动回滚（必要时）

停止 FastAPI，打开 PowerShell：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$unpack = Join-Path $project 'stage10_import'
$backupPath = (Get-Content -LiteralPath (Join-Path $unpack 'LAST_BACKUP_STAGE10.txt') -Raw -Encoding UTF8).Trim()
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& (Join-Path $unpack 'restore-stage10.ps1') -ProjectRoot $project -BackupDir $backupPath
```

回滚**仅恢复这次安装跟踪的代码和文档**，不删除以后通过上传页面写入的资料；如果已经上传过 PPTX 文字衍生版，这些资料仍可通过旧的 PDF/DOCX 管理流程操作。

## 安装包文件

```text
stage10_pptx_release.zip
├─ install-stage10.ps1
├─ restore-stage10.ps1
├─ stage10_patch.py
├─ backend/app/stage10_pptx.py
├─ tests/test_stage10_pptx.py
└─ docs/
   ├─ PROJECT_GUIDE_STAGE10_APPEND.md
   └─ API_DOCUMENTATION_STAGE10_APPEND.md
```

## 故障说明

- 安装时报“source compatibility preflight”：你当前的 `MaterialsPage.tsx` / `lib/api.ts` / `main.py` 与已确认的原结构不同。脚本会停止，不会做半截修改。请把三个文件发送给助手进行精确适配。
- 上传返回 401：先登录，检查浏览器和后端使用的是否为相同主机名（如全部用 `127.0.0.1`）。
- 上传返回 422：检查 PPTX 是否受损、只有图片、被加密、页数过多，或文件并非真正的 PPTX。
- 转写完成但无法检索：检查原 `/api/materials` 是否能正常索引 PDF/DOCX；第一次运行中文 Embedding 仍可能需要下载模型权重。
- `.ppt` 选择不到：这是老式 PowerPoint 文件，不在支持范围，先转为 `.pptx`。
