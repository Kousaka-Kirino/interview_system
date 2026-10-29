# Stage 21 / 第八组：AI 深度复盘、知识点自动整理、示范答案及费用说明

基线：成功安装 Stage 20 第七组 `UI_POLISH_PHASE7.md`。本组覆盖原优化清单的 **3、17、19、20**；清单第 **7** 项为“我的材料”上传说明，已于第一组完成。新功能不实现 PPT 逐页理解或专项 AI 追问。

## 变更记录

- `backend/app/services/report_ai.py`：单次 AI 复盘最多读取 10 道已提交题目，生成整体分析、按题号标记的参考回答和弱点（JSON）。对模型输出做 Pydantic 校验，只保留本场已有题号，80 分以上不自动标为弱点。
- `backend/app/services/deepseek_interview.py`：允许复盘使用 3600 输出 token 上限，正常出题/评分仍沿用 700 的默认值；延续官方 JSON 输出与 thinking disabled 设置。
- `backend/app/schemas/report.py`：扩展 AI 缓存字段 `example_answers`、`weak_points`，对既有缓存兼容（缺少字段使用空数组）。
- `backend/app/services/ai_study_points.py`：对齐本机 `stage7_review` 知识点库，使用原始题目作 quote 锚点，按 `user_id+session_id+source_anchor` 检查是否已导入。来源和原始文本保留；不信任模型生成的所谓 PDF 页面引用。
- `backend/app/api/reports.py`：复盘生成成功后写缓存、归入知识点；再次请求已有缓存不会重复调用 AI。写知识点失败时返回错误并支持无额外模型调用的重试。
- `backend/app/services/report_service.py`：未达到 80 分时不再将“本次没有高分题”当作优势。
- `frontend/src/pages/InterviewReportPage.tsx`：新增按**账号**选择的自动生成开关（默认关闭）、逐题示范回答、弱点清单、Markdown 导出、官方费用链接和有条件的价格示例。AI 分析存在时不再重复显示上方规则版三组结论；仍保留题目和评分。
- `frontend/src/lib/aiReview.ts`：纯函数清洗和导出本场真实题目；`backend/tests/test_ai_review_group8.py`、`frontend/tests/ai-review-group8.test.mjs`：回归测试。

## 自动生成的精确定义

1. 用户先在答辩复盘页主动勾选“此账号自动生成”；设置存入浏览器 `localStorage`，以用户名隔离。默认**关闭**，避免新账号未同意便上传资料或扣费。
2. 对 **已完成且有回答** 的新会话，首次打开复盘页若无缓存，自动调用一次 AI 分析。无须打开两次复盘；但未进入该页面不会后台自行生成。
3. 已保存的结果直接返回；刷新页面不重复收费。主动“重新生成”才会再次请求云端。
4. 新分析的薄弱点自动归入本地复习库，重复打开/重新生成不按同一题重复插入知识点。生成内容可以在知识点管理页面继续编辑与删除。
5. 自动保存只在有足够证据的弱点上执行；遇到高分、无回答或模型输出不合规情况，不会强行编造知识点。
6. 本功能无法保证模型每题回答准确；个人项目事实、数据和参考答案均需自行核验。

## DeepSeek Key 配置及安全

安装包**不包含 API Key**、`.env`、数据库、上传文件或真实简历。密钥已经出现在聊天记录里，建议在 [DeepSeek 控制台](https://platform.deepseek.com/) 撤销原密钥并创建新的。

在 Windows PowerShell 运行安装包根目录的 `configure-deepseek.ps1 -ProjectRoot 'C:\Users\Kirino\Desktop\interview_system'`。脚本使用隐藏的安全输入框，不回显密钥；保留 `.env` 其他字段，修改 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL=https://api.deepseek.com`、`DEEPSEEK_MODEL=deepseek-flash`。不要将 `.env` 提交到 Git。

## 收费说明与边界

DeepSeek 的官方模型 ID 以官方文档为准。本组使用 `deepseek-flash`（非思考 JSON 模式）；仅关闭 thinking，不代表无需收费。

参考官方 2026 年页面（**价格可能随时调整**）：Flash 输入缓存未命中约 ¥1 / 百万 tokens（闲时）、¥2 / 百万（峰时）；输出约 ¥4 / 百万（闲时）、¥8 / 百万（峰时）。举例，输入 3000 tokens、输出 2000 tokens，按缓存未命中估算为 ¥0.011～¥0.022，并非固定单次价格。模型有缓存命中价格，实际按账单确认：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing>。不应把这组 AI 生成功能称为“免费”。若 `.env` 切到本地 Ollama，则不会产生 DeepSeek API 调用费用，但仍需本地计算资源。

## 兼容性与回滚

- 增量安装器以 `docs/UI_POLISH_PHASE7.md`、再练页面功能为前置验证；其他文件保留版本校验。代码存在非重叠差异时用本机 `git merge-file` 离线三方合并，重叠冲突则停止。
- 安装前自动备份 `_patch_backups/group8_ai_时间戳`，失败尝试回滚。使用 `-DryRun` 先预检查；不连接 GitHub。
- 不修改现有 SQLite 表、不改动已有 AI 复盘记录及 Stage 13 登录资料。独立 `storage/data/study_review.db` 中新增知识点只属于当前账号。升级前建议用户自行备份 `storage`。
- 生成请求在较慢网络下可能失败；返回 503 的同时不会覆盖用户现有答辩记录。

## 本地测试与验收

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_ai_review_group8.py tests/test_document_preview_group3.py tests/test_resume_corrections_group2.py tests/test_dashboard_score_history_group6.py
Set-Location (Join-Path $project 'frontend')
npm.cmd run test:ui
npm.cmd run build
```

真实验收：

1. 登录，打开一场有回答的已完成答辩；原有评分和历史照常。
2. 关闭自动选项时刷新页面，不应调用模型。
3. 手动生成 AI 复盘，查看有据可查的弱点、逐题示范和知识点库。再次点击非刷新生成时返回缓存。
4. 点击“重新生成”前确认提示计费，验证重新分析、知识点不重复。
5. 导出 Markdown，确认含原题、原答、原评分、示范答案及弱点。
6. 切换账号，自动生成偏好独立；不同账号看不到另一账号的知识点。

**环境验证注意**：自动化测试均使用 FakeLLM/临时 SQLite，不会向 DeepSeek 发送实际请求或产生费用。当前交付环境无完整 npm 依赖，完整 Vite 构建与真实 DeepSeek 通信仍以本机结果为准。
