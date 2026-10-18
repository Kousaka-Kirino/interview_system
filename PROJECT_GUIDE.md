# AI 模拟答辩陪练系统 — PROJECT_GUIDE.md

> 文档状态：历史文档遗失后的重建版（2026-10-16，Stage 5C）。
> 工程路径：`C:\Users\Kirino\Desktop\interview_system`。
> 维护原则：本文件仅包含架构、文件职责、开发命令、接口位置、进度、验收和故障处理；**不包含业务源码**。
> 当前进度的描述来自先前交付记录，不等于全部功能已在用户电脑上完成实测。

## 1. 项目目标与部署边界

- 个人本地 Windows AI 模拟答辩：简历驱动，补充资料 RAG，配置评委、难度与自适应，持续问答、评分和复盘。
- 本地单用户 MVP；不使用 Docker、PostgreSQL 或 pgvector。
- 浏览器 React/TypeScript/Tailwind → Vite `/api` 代理 → FastAPI → SQLite、ChromaDB、本地中文 Embedding、DeepSeek。
- DeepSeek API Key 只保存在服务端 `.env`；绝对不要写进前端或上传到公开仓库。
- 云端模型调用会发送简历内容、回答和所选文档片段，建议先用脱敏文件测试。
- 当前无登录/权限隔离，不应对公网开放；开发环境仅绑定 `127.0.0.1`。

## 2. 技术栈与数据存储

| 层 | 技术 | 用途 |
|---|---|---|
| 前端 | React + Vite + TypeScript + Tailwind CSS v4 + lucide-react | 页面与 API 消费 |
| 后端 | Python 3.12.9、FastAPI、Pydantic、SQLAlchemy | 接口、配置校验与业务逻辑 |
| 关系数据 | SQLite | 简历元数据、会话、问答、报告 |
| 原文件 | `storage/uploads/` | PDF / DOCX |
| 向量检索 | ChromaDB PersistentClient | 补充资料片段索引 |
| Embedding | `BAAI/bge-small-zh-v1.5` | 本机计算中文向量，首次使用可能下载模型 |
| 答辩模型 | DeepSeek | 生成问题、评分及可选 AI 复盘 |

常见数据目录（取决于实际后端配置）：`storage/data/interview.db`、`storage/chroma/`、`storage/uploads/`。

## 3. 开发阶段记录

| 阶段 | 已设计/交付范围 | 本机验证备注 |
|---|---|---|
| Stage 0 | FastAPI 健康检查、SQLite 工程骨架 | 以当前项目为准 |
| Stage 1A | 评委风格、难度、自适应算法与预览 | 以当前项目为准 |
| Stage 1B | PDF/DOCX 简历上传、解析、列表、详情、删除 | 以当前项目为准 |
| Stage 2 | 资料上传、切片、Chroma 索引和 RAG 检索 | BGE 首次下载及 Windows 联调待验收 |
| Stage 3 | 多轮答辩创建、获取、回答、提前结束 | 真实 DeepSeek 调用需要 Key |
| Stage 4 | 历史、统计、离线规则报告、按需 AI 报告 | 先前隔离测试记录为 42 项 |
| Stage 5A | React 仪表盘、历史与统计 | 用户已报告 `npm.cmd run build` 通过 |
| Stage 5B | 简历/资料管理前端、RAG 检索测试 | 提供过源码；本机完整验收尚待确认 |
| Stage 5C | 配置页面接真实列表、创建会话、逐题回答、结束、离线复盘显示 | 本次安装包；待用户本机编译及联调确认 |

> 前端 Stage 5C **复用** Stage 3/4 后端现有接口，不新增后端数据库表或 HTTP API。

## 4. 主要目录和职责

| 路径 | 用途 |
|---|---|
| `backend/app/main.py` | FastAPI 应用、注册路由 |
| `backend/app/api/` | 健康、简历、资料、答辩及报告接口 |
| `backend/app/models/` | SQLite ORM 定义 |
| `backend/app/services/` | 简历、向量检索、LLM 与报告业务 |
| `backend/tests/` | 后端自动测试（实际路径以项目为准） |
| `frontend/src/App.tsx` | 主导航与 Hash 路由 |
| `frontend/src/pages/DashboardPage.tsx` | 历史与统计 |
| `frontend/src/pages/ResumesPage.tsx` | 简历管理 |
| `frontend/src/pages/MaterialsPage.tsx` | 资料管理与 RAG 测试 |
| `frontend/src/pages/InterviewConfigPage.tsx` | Stage 5C 配置并创建答辩 |
| `frontend/src/pages/InterviewSessionPage.tsx` | Stage 5C 问答、结束与离线报告 |
| `frontend/src/types/interview.ts` | Stage 5A/5C 公共类型及后端会话契约 |
| `frontend/src/types/resources.ts` | 简历/资料数据类型 |
| `frontend/src/lib/api.ts` | 历史、统计、简历与资料 API |
| `frontend/src/lib/interviews.ts` | 创建、读取、回答、结束及复盘 API |
| `frontend/src/lib/resources.ts` | 文件大小、日期与错误消息格式化 |
| `frontend/vite.config.ts` | Vite 插件及 `/api` 代理 |
| `PROJECT_GUIDE.md` | 本工程说明（权威版） |
| `API_DOCUMENTATION.md` | 后端接口契约（权威版） |

## 5. Windows 开发命令

### 5.1 检查工具

```powershell
python --version
node --version
npm.cmd --version
```

### 5.2 编译前端

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run build
```

### 5.3 启动后端（独立 PowerShell 终端）

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
$python = (Resolve-Path -LiteralPath '.\.venvs\interview_system\Scripts\python.exe').Path
Set-Location -LiteralPath '.\backend'
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 5.4 启动前端（另一个 PowerShell 终端）

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run dev
```

### 5.5 后端自动测试

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
$python = (Resolve-Path -LiteralPath '.\.venvs\interview_system\Scripts\python.exe').Path
Set-Location -LiteralPath '.\backend'
& $python -m pytest -q
```

### 5.6 本机验收入口

- 前端首页：`http://127.0.0.1:5173/#dashboard`
- 简历管理：`http://127.0.0.1:5173/#resumes`
- 资料管理：`http://127.0.0.1:5173/#materials`
- 答辩配置：`http://127.0.0.1:5173/#configure`
- 会话：`http://127.0.0.1:5173/#session/{真实会话ID}`
- FastAPI 文档：`http://127.0.0.1:8000/docs`
- OpenAPI：`http://127.0.0.1:8000/openapi.json`

## 6. Stage 5C 业务流程和接口关联

1. `GET /api/resumes`：选择简历，至少需要一份。
2. `GET /api/materials`：可选 0～10 份资料。
3. 前端提交 `POST /api/interviews`，后端生成第一题并返回会话 ID。
4. 前端跳转 `#session/{id}`，调用 `GET /api/interviews/{id}` 查看持久化题目。
5. 通过 `POST /api/interviews/{id}/answer` 提交当前题 `turn_id` 和回答。
6. 会话自行完成或通过 `POST /api/interviews/{id}/finish` 提前结束。
7. 完成后通过 `GET /api/interviews/{id}/report` 查看**离线规则版**复盘。

参数必须遵循既有 Stage 3 契约：评委 `friendly/neutral/pressure`；难度 `1～5`；自适应 `0～3`；主问题 `3～30`；追问 `0～2`。不要改用旧草稿中不兼容的顶层 `difficulty` / `interviewer_style` 或 0～100 直接传给后端。

## 7. Stage 5C 一键安装与回滚

- 发行包：`stage5c_release.zip`；ZIP 根目录包含 `install-stage5c.ps1`、`restore-stage5c.ps1`、`frontend/` 和 `docs/`。
- 推荐从 `Downloads` 解压到工程内独立的 `stage5c_import`，脚本通过自身目录定位包内文件，不依赖当前 PowerShell 所在目录。
- 安装前检查 Stage 5B 必要文件、安装包完整性；不自动下载依赖、不变更后端或隐私数据。
- 安装时在项目同级目录建立唯一备份，包括**即将覆盖的源码与两份文档**；先备份后写入。
- 历史文档已丢失：本发行包将工程根目录两份 Markdown 重建为完整 Stage 0～5C 说明（不含业务源代码）；如存在旧文档，先备份再替换。
- 安装后自动执行 `npm.cmd run build`；构建失败会尝试恢复这次改动。构建成功后请按第 5 节启动服务。
- 若需要手动回滚，按安装脚本打印的**实际备份路径**执行恢复脚本（勿猜测备份目录名）。

## 8. 故障排查

| 现象 | 处理 |
|---|---|
| `npm install` 持续卡住 | 使用 `npm.cmd`；检查网络及 registry；可试 `https://registry.npmmirror.com` 和 `--no-audit --no-fund` |
| Lightning CSS 缺少 `lightningcss.win32-x64-msvc.node` | 核对 `lightningcss-win32-x64-msvc` 可选原生包版本；必要时重装 optional 依赖 |
| `TS1294` 参数属性错误 | 在 `erasableSyntaxOnly` 下避免构造函数参数属性；使用普通成员声明 |
| 旧 Stage 5A 类型缺失 | `frontend/src/types/interview.ts` 必须同时包含历史、统计与会话类型；本包包含完整合集 |
| `apiRequest` 未导出 | Stage 5C 不依赖该符号；新 `lib/interviews.ts` 使用 fetch 和现有 ApiError |
| 资源页面为空 | 检查后端、简历与资料接口、Vite `/api` 代理 |
| `POST /api/interviews` 返回 503 | 首先检查后端 DeepSeek Key、网络连接与选中资料索引；不要伪造成功会话 |
| 报错 409/重复回答 | 先刷新会话，看服务器是否已成功处理上次回答；再决定是否重试 |
| 项目根目录缺少 Markdown | 本次脚本会重建，不再把原文档存在作为前提条件 |

## 9. 待办与已知限制

- Stage 5B 在实际 Windows 环境的上传、Embedding 下载与索引测试仍需确认。
- 未配置 DeepSeek Key 时可以访问仪表盘、管理资源以及**查看已有会话/规则报告**；不能实时生成新答辩题或评价答案。
- 前端目前无登录、多用户隔离、SSE/WebSocket、语音或自动保存回答草稿。
- SQLite `create_all()` 不能替代数据库结构迁移；将来改表时考虑 Alembic。
- 不删除仍在使用中的简历/资料；可能影响后续答辩回答。

## 10. 开发日志

- 2026-10-15：Stage 0～4 后端功能交付记录；Stage 4 隔离测试曾报告 42 passed，真实外部模型仍待联调。
- 2026-10-16：Stage 5A 仪表盘搭建；修复 Windows Lightning CSS 可选依赖、TypeScript TS1294；用户报告前端构建通过。
- 2026-10-16：Stage 5B 简历与资料管理交付；原安装脚本对文档存在性要求过严，因历史文档遗失而中断。
- 2026-10-16：Stage 5C 首版答辩配置草稿与既有接口冲突并覆盖共享类型，导致 10 个 TypeScript 错误；本包统一恢复共享类型并直接使用 Stage 3 契约。
- 2026-10-16：发布 Stage 5C 一键安装包，包含会话运行、离线复盘及**完整文档重建**；等待本机构建与功能验收。


<!-- STAGE5D_GUIDE_20261016 -->

---

## Stage 5D：历史会话复查、离线复盘与按需 AI 复盘（2026-10-16）

### 本阶段目标

- 从仪表盘历史记录直接进入进行中的答辩，或打开已完成答辩的详细复盘。
- 新增复盘专用路由 `#report/{session_id}`，支持浏览器刷新后通过会话 ID 重新读取数据。
- 在独立复盘页查看已回答、未回答、平均分、逐题评分趋势、规则优势/不足、下一步建议、逐题原始回答及评分反馈。
- 支持一键导出本地 UTF-8 TXT 复盘副本（无需云端服务，不会上传数据）；导出的文件包含答辩原文，注意保管。
- 可选 AI 深度复盘：页面打开时只做无额外费用的 GET 读取已缓存报告；仅在用户主动确认后才执行 AI POST。再次生成使用 `refresh=true`，可能产生额外 API 费用。
- 不新增后端路由、数据库表、Python 依赖、前端 npm 依赖；继续复用 Stage 3 和 Stage 4 接口。

### 修改文件及职责

| 路径 | 操作 | 职责 |
|---|---|---|
| `frontend/src/App.tsx` | 修改 | Hash 路由新增 `report` |
| `frontend/src/pages/DashboardPage.tsx` | 修改 | 历史列表新增继续答辩、查看复盘入口 |
| `frontend/src/pages/InterviewSessionPage.tsx` | 修改 | 答辩结束后显示完整复盘链接 |
| `frontend/src/pages/InterviewReportPage.tsx` | 新增 | 离线报告、评分图、逐题分析、TXT 导出、按需 AI 复盘 |
| `frontend/src/lib/interviews.ts` | 修改 | 调用按需 AI 报告接口，复用既有 API 请求机制 |
| `PROJECT_GUIDE.md` | 追加 | 当前阶段工程记录及命令 |
| `API_DOCUMENTATION.md` | 追加 | 当前阶段所消费的接口和异常约定 |

### Windows 安装与编译

前提：Stage 5C 安装和 `npm.cmd run build` 已通过。将 `stage5d_release.zip` 下载到用户的 `Downloads` 文件夹。

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$zip = Join-Path $HOME 'Downloads\stage5d_release.zip'
$unpack = Join-Path $project 'stage5d_import'
if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "找不到文件：$zip" }
New-Item -ItemType Directory -Path $unpack -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
$installer = Join-Path $unpack 'install-stage5d.ps1'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "找不到安装脚本：$installer" }
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& $installer -ProjectRoot $project
```

安装脚本会先检查项目和压缩包内容，**再备份**被修改的源码、两份文档；文档已存在时仅追加 Stage 5D 章节、保留原文；文档缺失时从发行包附带的 Stage 5C 重建底稿恢复，再追加 Stage 5D。文档追加使用唯一标记防止重复运行造成重复章节。自动运行 `npm.cmd run build`，构建失败尝试按备份清单回滚。备份位置为项目同级目录，由安装脚本实际打印，不要自行猜测。**不会运行 `npm install` 或覆盖 `.env`、`storage/`、后端源码。**

### 启动与测试命令

后端终端：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
$python = (Resolve-Path -LiteralPath '.\.venvs\interview_system\Scripts\python.exe').Path
Set-Location '.\backend'
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

前端终端：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run dev
```

单独编译前端：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run build
```

可选后端回归测试：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
$python = (Resolve-Path -LiteralPath '.\.venvs\interview_system\Scripts\python.exe').Path
Set-Location '.\backend'
& $python -m pytest -q
```

### 浏览器验收入口

- 仪表盘：`http://127.0.0.1:5173/#dashboard`
- 已有会话：`http://127.0.0.1:5173/#session/{实际会话ID}`
- 完成会话的详细复盘：`http://127.0.0.1:5173/#report/{实际会话ID}`
- API Swagger：`http://127.0.0.1:8000/docs`

### 验收清单

1. 重新编译通过且 Stage 5A～5C 页面保持可用。
2. 答辩历史中的 `active` 会话显示“继续答辩”，跳到 `#session/{id}`。
3. `completed` 会话显示“查看复盘”，跳到 `#report/{id}`。
4. 已完成的会话显示离线规则分析、评分趋势、逐题记录；无需 DeepSeek Key。
5. 无已完成会话时显示历史空状态；访问未完成会话的报告时提示无法查看，不伪造复盘结果。
6. 本地 TXT 导出成功；文件只在本机由浏览器生成。
7. AI 报告在用户没有点击时不执行 POST；若没有 API Key，主动生成应能显示后端 503 等错误，不影响离线报告。
8. 重新执行安装脚本不会重复追加 Stage 5D 文档。

### 限制和隐私

- 尚未配置 DeepSeek Key 时，无法创建新的答辩或生成新的 AI 复盘，但可以查看已有记录和离线报告。
- `GET /report` 只读返回已缓存的 AI 内容，不产生新的 AI 请求；点击“重新生成”需确认，可能产生费用。
- 本地 TXT 包含答辩问答与模型评分；不应上传公开仓库。
- 当前单用户本机系统无身份认证，勿向公网暴露。
- 前端已通过交付前的 TypeScript 静态检查；用户 Windows 真实编译、浏览器联调仍以安装脚本输出为准。

### 开发日志

- 2026-10-16：Stage 5D 添加历史记录可操作入口、独立离线复盘、逐题图表、TXT 导出及可选 AI 报告；延续 Stage 5C 已确认可构建的组件和接口结构。
- 本次**无后端 API 变更**。下一步优先针对真实会话运行数据做端到端回归、交互完善与隐私边界检查。

<!-- STAGE5E:BEGIN -->

## Stage 5E — 整体联调与异常恢复（2026-10-17）

### 目标与变更范围

- 新增全局运行状态浮窗：每 30 秒只读检查 `GET /api/health`，支持手动检查五个本地 REST 接口。
- 新增最近会话 ID 恢复：监听 `#session/{id}` 与 `#report/{id}`，本机浏览器仅存最近一个会话 ID，不存储简历、答案或密钥。
- 提交回答后遇到网络超时，用户可检查服务端已保存会话状态。**不会自动重复提交**，避免重复消费模型额度或收到 409。
- 新增 React 页面异常边界，提供界面重试和返回仪表盘入口；不会清除服务器端会话。
- 新增 `scripts/stage5e-smoke.ps1`：无 Key 环境检查健康、简历、资料、统计和历史五个只读接口。
- **最小侵入**：只对 `frontend/src/main.tsx` 增加组件挂载，不覆盖 Stage 5D 的 App、仪表盘、会话、报告或 API 客户端。
- 不需要新增 npm 依赖，也不修改 FastAPI、SQLite、ChromaDB 或 `.env`。

### 本次文件

| 文件 | 作用 |
|---|---|
| `frontend/src/components/RuntimeGuard.tsx` | React 渲染错误时的恢复入口 |
| `frontend/src/components/SystemHealthPanel.tsx` | 连接状态、接口自检、最近会话找回 |
| `frontend/src/main.tsx` | 最小范围集成两个组件 |
| `scripts/stage5e-smoke.ps1` | 五个只读 API 的本地联调脚本 |
| `PROJECT_GUIDE.md` | 保留原文并追加本节 |
| `API_DOCUMENTATION.md` | 保留原文并追加接口使用说明 |

### 安装与回滚

本阶段解压包根目录含 `install-stage5e.ps1` 与 `restore-stage5e.ps1`。安装脚本在**工程同级目录**创建带随机后缀的备份文件夹并保存 `manifest.json`。先保存备份，再写入源码/文档，最后运行前端构建；构建失败自动调用回滚脚本。重复安装不会重复注入入口或追加本阶段文档。回滚仅恢复清单列出的文件。

### 编译与启动命令

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run build
npm.cmd run dev
```

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
$python = (Resolve-Path -LiteralPath '.\.venvs\interview_system\Scripts\python.exe').Path
Set-Location .\backend
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### API 自检命令

需要先启动后端，然后新开 PowerShell：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\stage5e-smoke.ps1'
```

### 验收标准

1. `npm.cmd run build` 在用户本机通过，原 Stage 5D 导航和复盘仍可用。
2. 前端右下角显示运行状态；后端关停时出现离线提示，重启后能够恢复在线状态。
3. 接口自检能显示五个 REST 接口的结果（无真实简历内容）。
4. 打开 `#session/{实际ID}` 后刷新页面，再通过运行状态浮窗检查并返回最近会话。
5. 后端未启动时，页面不会因为全局面板请求失败而白屏。
6. 文档无业务源码，安装与回滚只操作明确清单中的文件。

### 局限和隐私

- 当前“断线恢复”是**只读状态核验和手动续接**，不是离线缓存回答或自动重发请求。
- 若提交请求超时但服务端已写入，先打开“运行状态 → 检查已保存状态”，对照题目/回答数，再决定是否再次提交。
- 健康检查仅表示 FastAPI 可达，不表示 DeepSeek、BGE 或 Chroma 完整可用。
- 本地浏览器仅保存一个会话 ID，用户可随时清除；无多用户鉴权的本机原型不能直接公网部署。

### 开发日志

- 2026-10-17：Stage 5E 源码和一键安装/回滚脚本已生成；Windows 本机构建、真实断线场景与接口自检**待用户执行验收**。

<!-- STAGE5E:END -->

<!-- STAGE6_REBRAND:BEGIN -->
## Stage 6 — 答辩训练系统中文文案统一

### 目标与范围

- 产品面对用户的中文名称统一为“答辩训练系统”，包含导航、页面标题、按钮、提示信息、中文题目提示词和日志中的人类可读文本。
- 术语规范：`答辩`、`答辩评委`、`答辩者`、`答辩会话`、`答辩复盘`。
- 仅修改项目中可识别的源码和文档文本内容；真实上传文件、数据库记录、运行时生成文件保持原状。
- 兼容性约束：保持英文模块名、路由、请求字段、数据库表结构、模型参数键与原有接口契约不变；不要因展示文案变化而执行数据库迁移。

### Windows 操作与验收

- 下载本阶段压缩包，解压后执行 `install-stage6-rebrand.ps1 -ProjectRoot <项目根目录>`。
- 安装前创建带校验记录的同级备份；安装后运行前端构建；失败时尝试自动回滚。
- 运行后端：在 `backend` 目录使用项目虚拟环境执行 `python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`。
- 运行前端：在 `frontend` 目录执行 `npm.cmd run dev`，浏览 `http://127.0.0.1:5173/#dashboard`。
- 检查导航栏、训练配置、答辩进行页面、历史记录和答辩复盘页的中文显示是否一致。
- 人工确认模型问题内容是否符合实际答辩场景；文本改名不代表业务流程已完成场景重构。

### 回滚与后续

- 备份清单保留安装时的原始字节；使用包内 `restore-stage6-rebrand.ps1` 可恢复原文件。
- 目前仍保留简历选择、原接口和现有训练逻辑。如后续转换为论文、课题、项目或毕业答辩，再单独调整资料模型、提示词结构与评价维度。
<!-- STAGE6_REBRAND:END -->

<!-- STAGE7_KNOWLEDGE_REVIEW_BEGIN -->

## Stage 7 — 答辩知识复习看板（雷达图 / 风险热力图 / 原文定位）

### 阶段目标与现状

- **仪表盘**：新增六维复习准备度雷达图、风险热力图、薄弱点清单和复习进度计数；没有个人标记数据时展示空状态，不捏造模型评分。
- **答辩会话**：在现有 `#session/{id}` 页面增加“知识重点与复习”入口；优先用当前问题关键词检索本地 Chroma 片段，选择后标注是否重点、严重度（1～5）、提问取向、能力维度与个人备注。
- **可追溯**：点击薄弱点打开保存的原文片段，并高亮所选文字。高亮发生在网页的 **RAG 片段阅读器**，不是 PDF/Word 原文件的页内高亮。来源和位置标识仅沿用 Chroma 原有元数据，缺失时不会杜撰页码。
- **复习状态**：待复习、已巩固、不认可；“不认可”可以填写理由，不自动算作已巩固；不同答辩会话可按会话 ID 查看，同步汇总到总仪表盘。
- **持久化**：所有标记记录保存至 `storage/data/study_review.db`（可由 `STUDY_SQLITE_PATH` 配置），与现有 `storage/data/interview.db` 分离；关闭浏览器后仍保留。回滚源码时**不删除这些学习记录**。

### 模块位置和兼容约定

- 独立 FastAPI Router：`backend/app/stage7_review.py`，通过原有 `app/main.py` 引入，所有新增接口使用 `/api/study/` 前缀。
- React 插件入口：`frontend/src/main.tsx` 仅增量挂载；独立前端文件在 `frontend/src/components/review/`。不覆盖现有 `DashboardPage.tsx`、`InterviewSessionPage.tsx`、`App.tsx`。
- 英文历史接口 `/api/interviews`、SQLAlchemy 模型、会话表和字段名保持不变。前台均采用“答辩”中文文案；保留当前 Ollama `.env`，不调用云服务生成风险。
- Chroma 检索使用已有索引上的**关键词匹配**，不会启动外部 embedding 或调用 Ollama。检索结果是“可能相关的候选片段”，并不能证明模型在某轮答辩中实际引用过它。
- 索引元数据无法可靠关联某份材料时，按材料 ID 筛选可能得到空结果；用户可手动粘贴真实资料片段。

### 安装、启动与检查

1. 下载 `stage7_review_release.zip` 并解压，运行包根目录 `install-stage7.ps1 -ProjectRoot <项目绝对路径>`，安装器会按文件清单备份至**项目同级**的独立目录，自动检查 Python 语法和前端 `npm.cmd run build`。
2. 保持原启动方式：后台进入 `backend`，运行 `& <虚拟环境python路径> -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`；前端进入 `frontend` 执行 `npm.cmd run dev`。
3. `GET http://127.0.0.1:8000/api/study/health` 返回 JSON 且 `status=ok`。
4. 打开 `http://127.0.0.1:5173/#dashboard` 查看新增图表。在某次答辩页面点击左下角知识标记按钮，搜索/添加真实知识点后回到仪表盘查看风险热力图；点击任意薄弱点查看高亮、标记已巩固/不认可。
5. 首次空图表属正常状态；只有至少一个维度有标记才能计算相应准备度，六维全部有数据时才绘制完整的雷达面积图。

### 风险准备度计算说明

六维：理论依据、论证逻辑、研究方法、数据证据、创新价值、答辩表达。严重度由用户选定；重点知识的风险权重更高，已巩固的剩余风险折减；不认可的条目仍保留一部分待处理风险。没有被标记的维度值为 null。图表衡量**自我复习准备度**，不是模型评分、考试成绩，也不是客观的教学测评。

### 数据安全和限制

- 单人本机版，API 无用户鉴权；仅在可信本机使用，勿暴露到公网。
- 不改写 `.env`，不保存 API Key；新增业务记录可能包含用户手动摘录的敏感文字，应按本地学习资料保护及备份。
- 自动回滚只恢复本阶段追踪的前后端源文件和两份 Markdown 文档；不删除本阶段创建的 SQLite 数据库，不修改已有上传文件。
- 若当前项目入口不同，安装前检查将停止，而不是猜测修改不明结构。

<!-- STAGE7_KNOWLEDGE_REVIEW_END -->

<!-- STAGE7B_DASHBOARD_LAYOUT_BEGIN -->

## Stage 7B - Unified dashboard: five equal cards, inline radar and history toggle

**Goal:** keep the current dashboard in one coherent layout. The existing statistics row now has five equal-width entries at desktop width, with **History Defense** immediately after **Historical Average Score**. The radar chart, risk heatmap and weak-point checklist occupy the original historical-record panel position by default. Clicking the History Defense card reveals the original history list at its original location, and clicking again returns to the risk review.

### Architectural decisions

- Preserve the existing DashboardPage component, existing history fetch, report links, and all saved data. A scoped React portal-based layout bridge reuses the original history panel DOM without copying or replacing the history list implementation.
- Add a five-card responsive grid: 5 columns for sufficiently wide screens, 3 on medium screens, 2 on narrow screens. On very narrow screens the five cards wrap instead of being squeezed beyond readability.
- Do not mount a second Stage 7 risk dashboard at the bottom. The former independent append point is replaced with the historical-panel position.
- Knowledge-point tagging, risk severities, questioning orientation, original-text highlighting, local SQLite and existing RAG search are unchanged.
- The radar chart is a *review readiness* visualization based on saved self-assessments and not a validated model-scored capability measure. Missing dimensions remain missing.
- The dashboard integration matches a historical-average score card and an existing history section at runtime. If a customized DashboardPage has different markup, a non-destructive warning is shown; do not guess selectors or erase existing panels.

### Files tracked by Stage 7B

- `frontend/src/components/review/ReviewWorkspace.tsx`: switches from append-to-bottom to inline dashboard integration.
- `frontend/src/components/review/DashboardDock.tsx`: layout bridge, accessible fifth entry and history toggle.
- `frontend/src/components/review/dashboardDock.css`: five-column layout and smaller-screen breakpoints.
- `PROJECT_GUIDE.md`, `API_DOCUMENTATION.md`: appended change log and unchanged API contract.

### Operational verification

1. Execute the Stage 7B installer, then inspect its automatic Vite/TypeScript build output.
2. With FastAPI and the Vite dev server active, open `http://127.0.0.1:5173/#dashboard`.
3. At desktop width, verify five side-by-side cards; **History Defense** directly follows **Historical Average Score**.
4. Verify radar, heatmap and weakness list occupy the previous history area (not appended below the entire page).
5. Click History Defense to show the real historical list; click again to return to risk review.
6. Open a weak point to verify saved source-text highlighting and the mastered/disputed options still work.

**Rollback:** use `restore-stage7b.ps1` with the backup path printed by the installer. Rollback restores only source and Markdown files touched by Stage 7B; it never removes `storage/data/study_review.db` or any interview/defense records.

<!-- STAGE7B_DASHBOARD_LAYOUT_END -->

<!-- STAGE7C_DARK_THEME_BEGIN -->

## Stage 7C — 答辩工作台深色主题统一（仅前端）

- 目标：保持五张等宽统计卡片与原工作台一致，修复“历史答辩”按钮的白色背景；使知识复习看板、六维雷达图、风险热力图、薄弱点列表、知识标记与详情弹窗采用一致的深海军蓝主题。
- 布局保留：宽屏五卡并列；点击顶部“历史答辩”查看原历史记录，再点击返回风险看板。原来的答辩数据、历史列表与导航不作修改。
- 配色：页面深海军蓝背景、藏蓝卡片、低对比灰蓝边框、淡色正文、青蓝强调；高风险与中风险分别使用暗红/暗琥珀底色。
- 雷达图仍显示依据用户知识标记产生的“复习准备度”，不是 AI 正式能力评分；缺失维度不编造数值。
- 本版只替换以下前端文件：`frontend/src/components/review/ReviewWorkspace.tsx`、`RadarChart.tsx`、`dashboardDock.css`，并新增 `stage7c-dark.css`。
- 不修改 API、FastAPI、Python、SQLite、ChromaDB、上传文件、.env、Ollama 模型或现有登录状态。
- 安装：解压 `stage7c_theme_release.zip`，用 `install-stage7c.ps1 -ProjectRoot <工程根目录>` 自动备份并运行 `npm.cmd run build`。回滚见 `restore-stage7c.ps1`，实际备份路径来自安装日志或 `LAST_BACKUP_STAGE7C.txt`。
- 约束：不全局覆盖应用主题；Stage 7C 的深色主题样式仅作用于新增的复习模块及第五张统计卡片。

### 预研：后续登录功能（本次不实现）

- 初期继续使用现有 SQLite，不需要运行单独的 MySQL/PostgreSQL 服务。个人使用可先选择本地单用户模式，未来扩展多账号再实施用户与数据归属迁移。
- 身份认证应在 FastAPI 后端实现；密码仅存 Argon2id 等安全密码哈希，不能明文保存；使用服务器控制的会话和 HttpOnly、SameSite Cookie，不将长期凭据写入 localStorage。
- 注册/登录/退出、会话续期、密码重置、接口鉴权、请求频率限制都应先后端实现，再开放正式登录页面。无验证码不等于无暴力破解防护。
- 多账号必须通过 `user_id` 隔离答辩会话、简历、材料、上传文件、向量库检索与复习知识点；原有历史数据需设计明确的迁移归属，不能自动暴露给新账号。
- 本设计仅为后续迭代建议，不代表接口已存在。更多内容见安装包的 `docs/LOGIN_DESIGN_PROPOSAL.md`。

<!-- STAGE7C_DARK_THEME_END -->

<!-- STAGE8A_OWNERSHIP_BEGIN -->

## Stage 8A — 初始用户与历史数据归属预迁移（2026-10-17）

### 实施边界与状态

- 初始账号名：`aslan`；账号 UUID 在本机迁移时生成，固定且不会因为重启改变。
- 初始密码仅在本机交互式密码提示中输入；不写入项目文件、ZIP 或 `.env`；仅存储带随机 salt 的 `scrypt` 派生值。
- 初始密码已知且较弱，标记 `must_change_password=1`。Stage 8B 首次登录必须先强制修改密码，之后才能访问私有业务接口。
- 本阶段**未启用登录和授权**，也**未完成多用户隔离**；在 Stage 8C 安全验收完成前不可开放新用户。
- 旧答辩记录、简历、材料及问答不搬迁、不删除，存储路径不更换。

### 备份与迁移

在停止 FastAPI 之后执行 Stage 8A 安装脚本：`stage8a_import/install-stage8a.ps1 -ProjectRoot <项目根目录>`。

1. 检查主 SQLite 数据库及可选的复习 SQLite 完整性。
2. 在项目同级目录备份完整 `storage/`，包含 SQLite、Chroma、上传内容和现存的 WAL 文件；保留原来的两份 Markdown 文档。
3. 在主数据库新增 `app_users`、`app_legacy_datasets`、`app_legacy_ownership`、`app_file_ownership`、`app_vector_ownership`、`app_stage8a_meta` 六张辅助表。
4. 创建 `aslan` 初始账号，扫描原业务表的已有行，归属关联初始用户 UUID；上传文件用相对路径、文件大小和 SHA-256 记录归属。
5. 将现有 Chroma 目录登记为初始用户的**待拆分旧知识库**，暂时不重建 collection，避免破坏已有 RAG。
6. 验证迁移前统计数量与归属记录数量相等，输出 `stage8a_migration_report.json` 到备份目录。

以上属于**归属盘点**，不是能阻止越权的数据库行级授权。没有稳定主键的旧表可能按 SQLite rowid 建立临时行关联，Stage 8B/C 需要迁移到稳定 UUID 外键。原业务数据未添加默认指向 aslan 的 `user_id`，以免未来新用户意外继承旧账号权限。

### 后续 Stage 8B / 8C 必须完成的约束

- 认证会话从服务端签发、校验和撤销；Cookie 使用 HttpOnly、适当 SameSite 和 CSRF 防护；登录速率限制。
- 所有私有路由通过 `current_user` 获取用户 UUID，而不是信任前端传递的 `user_id`。
- 简历、材料、答辩、问答、报告、知识点、统计的创建与查询必须按用户限制；跨账号资源访问返回 404 或拒绝。
- Chroma 向量集合和检索流程按用户隔离，旧集合仅归 aslan；不能继续让 Stage 7 检索代码遍历所有用户集合。
- 上传文件从后端数据库资源 ID 解析路径并验证归属，禁止路径穿越与猜测文件名下载。
- 旧数据全部归初始用户，新用户起始数据空白；通过跨用户接口、知识库、文件和看板隔离测试后才能开放注册。

### 回滚约束

安装脚本失败会尝试从同级完整备份恢复。手动回滚会把 `storage/` 恢复为安装前快照，因此安装后新增的业务数据不会保留在项目中；恢复脚本会先将当前 `storage/` 移到另一个同级目录作保留。不得在 FastAPI 运行时回滚。

<!-- STAGE8A_OWNERSHIP_END -->

<!-- STAGE8B_AUTH_BEGIN -->

## Stage 8B：初始账号登录与访问保护（2026-10）

### 范围

- 本阶段在 Stage 8A 的 `app_users` 初始账号上接入 FastAPI 认证及 React 登录界面。
- 注册功能仍然**禁用**；`aslan` 是本阶段唯一允许的账号。Stage 8C 实施 SQLite 主体隔离、Chroma 用户集合、上传目录隔离与双账号测试后再开放注册。
- 旧会话、简历、报告、复习标记全部保留。不会在本阶段修改原业务表或重新创建 Chroma 向量。
- 首次登录必须修改初始密码，密码至少 12 位；密码采用 Stage 8A 兼容的 scrypt 哈希方案；新哈希不会保存明文。

### 认证架构

- 新增 `backend/app/stage8b_auth.py`，在已注册现有路由后安装 FastAPI 访问保护中间件。
- 仅 `/api/auth/login`、`/api/auth/me`、`/api/auth/change-password`、`/api/auth/logout` 支持未进入业务工作台时访问；其余所有 FastAPI 入口默认要求有效登录。
- 访问范围仅允许本机 loopback IP，远程访问拒绝。存在有效会话但 `must_change_password=1` 时，业务接口仍返回拒绝。
- 登录使用高熵随机 token，SQLite 只保存 SHA-256 token 摘要；浏览器的 Cookie 使用 HttpOnly / SameSite=Lax，12 小时到期；TLS 时启用 Secure。退出登录会撤销服务端 token。
- 登录错误按来源和账号计数，10 分钟内累计 5 次失败会暂时锁定；修改密码会撤销此账号先前的全部会话并换发新会话。
- 对 POST/PATCH/DELETE/PUT 校验本机允许来源 `Origin`；兼容 Vite 的 `/api` 代理请求。端口相同但 `localhost`/`127.0.0.1` 混用时可能需要重新登录，建议始终使用 `127.0.0.1`。

### 安装与启动

1. 安装前停止 FastAPI（`Ctrl+C`），关闭其他数据库写入程序。
2. 解压 `stage8b_release.zip` 并执行包内 `install-stage8b.ps1 -ProjectRoot <工程根目录>`，自动备份源码、文档和主 SQLite 快照，新增账号会话表，验证 Python、执行 `npm.cmd run build`。
3. FastAPI：进入 `<工程>/backend`，用 `<工程>/.venvs/interview_system/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`。
4. 前端：进入 `<工程>/frontend`，执行 `npm.cmd run dev`；浏览器打开 `http://127.0.0.1:5173/#dashboard`。
5. 登录账号 `aslan`，使用 Stage 8A 本机初始化时设置的初始密码；首次登录更换为至少 12 位的新密码。
6. 验收：退出后刷新，旧会话不能继续访问；未登录访问 `GET /api/interviews/history` 应返回 401；正常登录后显示旧记录与风险看板。

### 数据迁移与备份

- 本次仅修改主 SQLite，新增 `app_auth_sessions` 和 `app_auth_attempts`，不触碰 `study_review.db`、上传文件或 Chroma。
- 安装时使用 SQLite 官方 backup API 制作**一致性主数据库快照**，文件保存在工程同级 Stage 8B 备份目录中，原业务资料不复制第二份。
- 自动安装失败时，脚本会尝试回滚跟踪文件及主数据库快照。
- 手动回滚需停 FastAPI，使用 `restore-stage8b.ps1`；默认只恢复代码和文档。恢复主数据库需要额外传 `-RestoreDatabase -ConfirmDataLoss`，并会再创建一份回滚前数据库备份；回滚会撤销回滚快照之后的密码/会话变化。
- `PROJECT_GUIDE.md` 和 `API_DOCUMENTATION.md` 保留既有章节、仅追加本阶段内容，不存业务源码或密码。

### 未完成：Stage 8C

- 当前是**单用户登录与访问保护**，并不是多用户资源隔离。不可提前开放注册，不可用“能登录”代替按 `user_id` 授权。
- 后续需完成按当前 user_id 限制所有简历、资料、答辩、报告、复习点及 Chroma 索引、文件下载，并通过双账号越权测试。

<!-- STAGE8C1_BEGIN -->
## Stage 8C-1 — 本地账号个人资料与知识复习数据归属（2026-10-17）

本阶段维护现有 `aslan` 单账号模式。**尚未开放注册、多用户同时使用或跨账号访问**，原因是原答辩会话、简历、资料、上传下载及 Chroma 索引尚未逐接口验证归属。不得仅依赖登录界面隐藏数据来宣称这些资源已隔离。

### 本次新增

- 右上角「个人资料」：查看/修改昵称与联系邮箱（仅作为本机备注，不做邮箱验证码验证）。
- 已登录情况下修改密码：无需提供旧密码，也无需验证码；密码只要求非空、最大 256 字节，SQLite 中仍使用带盐的 `scrypt` 哈希。更改后注销其他登录会话。
- 在主 SQLite 增加 `app_user_profiles`，归属于 `aslan` 的用户 UUID。
- 为 `study_review.db` 中既有 `study_knowledge_points` 增加 `user_id`；旧知识点全部归属 `aslan`；创建、列表、概览、更新与删除均以服务端登录会话的用户 ID 过滤，不能由请求体指定归属。
- Chroma 历史知识库仍属于原账号；检索前核对 Stage 8A 的归属登记。新账号注册继续禁止。

### 安装与数据保护

1. 先停止 FastAPI，确认 Stage 8A、8B 和 Stage 7 已成功安装。
2. 安装工具仅允许匹配已验证基线的四个源码文件，防止无声覆盖私人改动。
3. 安装前分别通过 SQLite backup API 为 `interview.db` 与 `study_review.db` 制作一致性快照，另备份四个源文件、安装脚本目标和两份工程 Markdown 文档。
4. 安装后验证 Python 语法、主/复习数据库完整性和 `npm.cmd run build`。失败时自动尝试同步恢复代码与数据库。
5. 回滚时需停止 FastAPI，使用 `restore-stage8c.ps1 -ConfirmDataLoss`；回滚前另行保存安装以来的最新数据库状态，避免修改密码或新增知识点彻底丢失。

### 后续必须完成的隔离工作

在添加任何第二用户或注册接口之前，必须取得并逐个审计原答辩、简历、资料、报告、下载和 RAG 检索源码，对每个读取/写入路径实施 `user_id` 服务端授权，并将 Chroma 与上传资料实际迁移为用户独立命名空间；完成双账号越权测试后才能开放多账号。

### 启动与验收

后端：在工程根目录切入 `backend/` 后执行 `.venvs/interview_system/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`（解释器完整路径以工程根目录解析）。前端：在 `frontend/` 执行 `npm.cmd run dev`。登录后在页面右上角选择「个人资料」。

<!-- STAGE8C1_END -->

<!-- STAGE8C2_BEGIN -->
## Stage 8C-2：答辩主资源归属与访问控制（本机单账号过渡）

**项目阶段：** Stage 8A 已建立初始用户 `aslan` 的历史归属清单；Stage 8B 已加入本机登录认证；Stage 8C-1 已实现个人资料与复习知识点过滤；Stage 8C-2 继续完善主要业务资源的用户归属。

### 修改范围

- `backend/app/stage8c2_guard.py`：访问答辩会话、简历、资料的单个 ID 时校验归属；建立答辩前验证关联的简历和资料；保存复习知识点时核验关联的会话与资料 ID。
- `scripts/stage8c2_owner.py`：根据本机实际 SQLite 表名预检查，在明确识别出的简历、资料和答辩会话主表建立 `user_id` 及索引，把现有记录归属到 `aslan`；旧业务接口创建的记录暂由单账号触发器标记所有权。
- `backend/app/main.py`：挂载 Stage 8C-2 资源归属校验中间件；不改变既有 API 路径。
- 根目录 `PROJECT_GUIDE.md` 与 `API_DOCUMENTATION.md`：维护阶段记录，绝不以文档替代业务代码。

### 安全边界

本阶段**没有开放第二个账号**，没有开放注册。旧业务中的列表、统计、文件路径、RAG/Chroma 集合尚未全部完成按用户改造，单纯的 `user_id` 字段不等于多租户隔离。Stage 8B 必须继续保持本机 `127.0.0.1` 访问限制，并拒绝任何非初始用户。未来开放注册前，必须拆除临时 `aslan` 自动归属触发器，改为后端依据登录用户绑定，并测试所有业务 API、文件及向量检索的跨用户访问拒绝。

### 安装和备份

1. 先停止 FastAPI（端口 8000），停止同时写入数据库的其他进程。
2. 下载 `stage8c2_release.zip`，运行包内 `install-stage8c2.ps1 -ProjectRoot <工程路径>`；脚本会验证 Stage 8A、8B、8C-1 状态。
3. 安装器在工程同级建立 `*_stage8c2_backup_*`，保存源文件、两份文档、主 SQLite 和复习 SQLite 一致性快照。异常时尝试恢复。
4. 安装器输出 `SQLITE_SCHEMA_INVENTORY.json`，只包含表名、字段名及行数，不包含用户密码或业务数据；若主表名称无法唯一确定，安装在修改前停止。
5. 安装完成后，重启 FastAPI 与 React，验证旧答辩记录、简历、补充资料、复习功能仍能读取。

### 离线验证命令

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
& $python (Join-Path $project 'scripts\stage8c2_owner.py') --project-root $project --verify
```

### 下一阶段

Stage 8C-3：根据实际业务模型逐接口实现列表/统计过滤和上传文件访问控制；将原 Chroma 索引隔离到账号空间；完成双账号越权回归测试后再考虑开放注册。
<!-- STAGE8C2_END -->

<!-- STAGE8D_NAVFIX_BEGIN -->
## Stage 8D — 导航栏账户入口位置修复

- 只改前端账户控件的挂载位置与响应式布局；保持深蓝/青蓝主题、按钮样式、登录、密码与个人资料逻辑不变。
- 原独立 `position: fixed` 账户面板容易在窄屏覆盖左侧导航。改为在 `nav[aria-label="主导航"]` 的“开始答辩”按钮之后插入 React Portal 挂载点。
- 账号标签、个人资料与退出登录会跟随导航栏布局自然换行，不再悬浮遮挡导航按钮。
- 如果导航链接尚未渲染，入口会等待出现；如导航结构变化则在导航容器内安全降级。
- 此更改未新增 API、数据表或后端依赖。
- 测试重点：宽屏按钮紧挨“开始答辩”；缩窄窗口时不重叠；个人资料与退出登录可用；重新登录后位置正常。
- 安装方式：`stage8d_navfix_release.zip` + `install-stage8d.ps1`，构建失败时回滚跟踪文件。
<!-- STAGE8D_NAVFIX_END -->

<!-- STAGE9_VOICE_TIMER_BEGIN -->
## Stage 9：本地答辩语音输入与逐题倒计时

### 功能范围

- 新增 `frontend/src/components/speech/DefenseVoiceTimer.tsx` 和 `speechTimer.css`，只在 `#session/{id}` 且有未回答题目时显示。
- 每道题在客户端**首次检测到未回答题目时**开始 120 秒倒计时。使用 `localStorage` 按 `session_id + turn_id` 保存截止时间；刷新、切换页面后继续计时，**不是服务端强制时限**。用户修改系统时钟可能影响倒计时。
- 点击开始/停止录音，浏览器使用 `MediaRecorder` 录音，发送至本机 FastAPI，使用 `faster-whisper` CPU `base` 模型识别普通话。首次转写时模型可能从 Hugging Face 下载到本地缓存。
- 识别结果进入独立可编辑草稿，点击“提交本题回答”通过既有 `POST /api/interviews/{session_id}/answer` 提交；原有文本回答框保留。不会自动提交转写内容。
- 两分钟内未完成：弹窗选择“继续完成本题”或“跳过并进入下一题”。继续后显示超时用时；跳过通过原有回答接口传送 `【本题超时跳过：用户选择进入下一题，未实际作答】`。**旧评分逻辑可能仍给跳过文本打分**，本阶段不改后端业务算法。
- 新题由会话 GET 轮询发现并重新计时。录音、转写、文字编辑均计入限时。语音上传采用登录 Cookie，不额外公开接口。
- 音频只写入临时文件并在响应结束后删除；不会自动保存永久录音。

### 安装、验证与回滚

- ZIP 根目录脚本 `install-stage9.ps1`、`restore-stage9.ps1`，Windows PowerShell 5.1/7 均使用 ASCII 脚本避免编码问题。
- 安装前关闭 FastAPI，安装器检查 Stage 8B 登录、Stage 5E 前端入口、Python venv、npm.cmd。
- 备份 `backend/app/main.py`、`frontend/src/main.tsx`、新增语音模块、两份 Markdown 文档；失败时自动恢复。可选 `-SkipDependencyInstall` 跳过 pip，后端语音接口会在缺失依赖时返回 503。
- `faster-whisper==1.2.1` 与 `python-multipart` 安装在项目虚拟环境；pip 安装的依赖不随源码回滚卸载。
- 后端：`cd backend` 后使用 `.venvs/interview_system/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`。
- 前端：`cd frontend` 后 `npm.cmd run dev`，进入真实会话地址 `http://127.0.0.1:5173/#session/{id}`。
- 运行本地测试：`& .\.venvs\interview_system\Scripts\python.exe .\stage9_import\tests\test_stage9_speech.py`（依赖已安装后）。

### 维护备注

- 未修改 `InterviewSessionPage.tsx`、业务表、登录密码、已有答辩答案和 `.env`。
- 语音入口使用现有 `src/main.tsx` 做增量挂载，深海军蓝色卡片，渲染在答辩页面 `<main>` 前部。若工程入口不同，安装程序将先停止，不做猜测式覆盖。
- 建议下一阶段增加原生 `skipped` 状态和服务端 `question_started_at`；在此之前，超时与跳过语义属于前端兼容层。
<!-- STAGE9_VOICE_TIMER_END -->

<!-- STAGE9B_LAYOUT_BEGIN -->
## Stage 9B: answer-area speech/timer layout

- Stage 9 voice recording and the two-minute timer now appear immediately above the current question's existing answer textarea, inside the existing answer area instead of at the top of the page.
- The timer is still scoped to session ID plus turn ID, stored in localStorage. Moving the portal does not reset the countdown.
- No FastAPI, database, speech model, session scoring or login changes are required.
- If the original textarea is not present, the add-on stays hidden instead of appearing above unrelated page content.
- Validation: open an active defense session, verify the question and its timer/voice controls are visible in the same answer area, then refresh and confirm countdown continuity.
<!-- STAGE9B_LAYOUT_END -->

<!-- STAGE9C_DURATION_BEGIN -->
## Stage 9C — Configurable per-question defense time (0–60 minutes)

- The configuration screen now includes `答辩时间（每题，分钟）`; accepts **integers from 0 to 60**. Default: **2** minutes.
- `0` means **unlimited per-question time** (no countdown, overtime modal or automatic skip). `1–60` starts the selected countdown when the unanswered turn loads.
- The selected value is assigned to the *newly created session* on the transition from `#configure` to `#session/{id}`. Stored in the current browser's `localStorage` under a session-scoped key; existing sessions with no key retain the former 2-minute behavior.
- Existing per-question deadlines (`stage9:deadline:{sessionId}:{turnId}`) remain in place; page refresh does **not** reset the timer. A new question gets a separate deadline. Timeout continues to ask the user whether to keep answering or skip.
- The existing Whisper transcription endpoint still limits a **single recording to roughly 2 minutes**, even if the answer window is longer or unlimited. Users can make multiple recordings or type.
- The UI is still inserted additively without rewriting `InterviewConfigPage.tsx` or `InterviewSessionPage.tsx`. If custom frontend route or DOM differs, the configuration control may need explicit page integration.
- Limitation: time preferences and deadlines are **client-side**, not enforced by FastAPI. They do not synchronize across browsers/devices and may be lost if the user clears site data. No database schema, Ollama or API changes.
- Validation: test 0, 1, 2, 60; reject -1, 61, fractions and blank; confirm new sessions inherit setting; check page refresh and the old-session 2-minute fallback.
<!-- STAGE9C_DURATION_END -->
