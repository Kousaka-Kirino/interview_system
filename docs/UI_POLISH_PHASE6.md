# 第六组：数据概览、评分趋势与练习评级（Stage 19）

> 2026-10-27 · 《系统优化方案》第 1 项 · 基于 Stage 18 第五组代码，属于第六组增量改动

## 需求与实现

- 统计卡保留现有历史平均分：`GET /api/interviews/statistics`；它是**当前账号所有已评分回答的均分**，包含已保存且有分数的进行中答辩回答。原统计字段及历史答辩筛选/分页不变。
- 新增「练习评级」（根据上述历史回答均分）：`>=80` 良好，`>=60 且 <80` 待提升，`<60` 需加强。属于页面辅助分档，**不是能力认证、模型打分或学校官方评价**；没有已评分回答时显示「暂无评级」。
- 新增最近两场有效场均分的比较：「较上次 +3.2 分 / −3.2 分 / 与上次持平」。这里最近两场特指**已完成且至少一题有有效分数**的答辩，按创建时间、会话 ID 倒序选取；不是整个数据库所有回答的均分变化。不足两场时显示解释，不编造 0 分。
- 新增最多 **20 场**的分数折线：每个点是该场**有效已评分回答的平均分**；跳过没有有效评分的会话、未完成的会话，以及答案为空的题。成绩真实为 **0** 时会作为有效评分纳入。返回点按时间升序呈现。示图基于固定 0～100 分纵轴（与当前项目的评分范围一致），鼠标悬停可查看日期与题数；移动端可横向滚动。
- 空库、单场、加载中、API 出错显示独立明确状态。历史列表与统计沿用原有请求；趋势使用独立的 AbortController 与加载/错误状态，按刷新按钮更新、不会随列表翻页重复请求；即使趋势接口故障，原有统计卡及历史列表也不会被清空。不会产生额外模型调用。
- 删除数据概览底部残留的「本机单用户开发版本」展示字样，改成对评分含义的提示。不会删除实际诊断服务或数据库功能。

## API

`GET /api/interviews/score-history`，要求当前账号已登录，由既有 `get_db()` 返回该账号 SQLite 会话。**只读 SQL 查询，无模型调用、不写库**。

成功 `200`：

```json
{
  "points": [
    {"session_id": "uuid-1", "created_at": "2026-10-25T10:00:00", "average_score": 72.5, "scored_answers": 2},
    {"session_id": "uuid-2", "created_at": "2026-10-26T10:00:00", "average_score": 75.7, "scored_answers": 3}
  ]
}
```

这是响应结构**示例**，不是测试中真实账号分数；结果为空时为 `{"points": []}`。最多返回最近 20 个**有评分的已完成答辩**，分页只用于「历史答辩」列表而不影响走势图。已登录者不能通过 URL 参数跨账号指定用户；离线统计不需要 DeepSeek / Ollama。

## 修改范围

- 后端 `backend/app/services/report_service.py`：单条 GROUP BY 查询计算最近 20 场场均分，过滤已结束、真实回答和有效分数。
- 后端 `backend/app/api/reports.py`、`backend/app/schemas/report.py`：只读接口与 Pydantic 契约；静态路由放在动态 `/{session_id}/report` 前，避免被错误匹配。
- `backend/app/stage8c2_guard.py`：将 `score-history` 加入已有的静态路由集合，不把它误当成需要会话归属验证的 UUID；继续保留登录认证和每账号 `get_db()` 隔离。
- 前端 `frontend/src/pages/DashboardPage.tsx`：展示评级/变化/走势图、加载与错误状态，保留原有分页、筛选、刷新。
- 前端 `frontend/src/components/dashboard/ScoreHistoryChart.tsx`：SVG 折线图，零/一点/多点状态。
- 前端 `frontend/src/lib/scoreInsights.ts`、`frontend/src/lib/api.ts`、`frontend/src/types/interview.ts`：展示辅助逻辑、请求接口、类型。
- 测试 `backend/tests/test_dashboard_score_history_group6.py`、`frontend/tests/dashboard-insights-group6.test.mjs`；同步更新 `API_DOCUMENTATION.md`、`frontend/README.md`、本文档。

## 验证

PowerShell，从项目根目录执行：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_dashboard_score_history_group6.py tests/test_resume_corrections_group2.py tests/test_document_preview_group3.py
if ($LASTEXITCODE -ne 0) { throw '后端回归测试失败' }
Set-Location (Join-Path $project 'frontend')
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm 依赖安装失败' }
npm.cmd run test:ui
if ($LASTEXITCODE -ne 0) { throw '前端回归测试失败' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
```

浏览器测试：①新账号无历史分显示空状态；②只有一场有效答辩时评级出现但比较为「至少完成两场」；③完成第二场后显示环比增减并画折线；④刷新、列表筛选及分页不改变走势；⑤切换账号后只显示当前账号数据。

测试使用临时账号数据库；不触碰用户真正的 `storage/`。

## 安装与安全

- 前置条件：已安装并验证 Stage 18 第五组（存在 `docs/UI_POLISH_PHASE5.md`、`frontend/src/lib/answerDraftBridge.ts` 等）。
- 补丁 ZIP 的 `install-group6.ps1` 支持 `-DryRun`，通过 SHA-256 检查包内容；已存在的 UTF-8 文件如只是 CRLF 差异，保持本地行尾；真有不重叠差异时借助**本机 Git merge-file** 做三方合并，**不访问 GitHub**；重叠冲突停机，不强行覆盖。
- 安装之前对每个待替换文件备份到 `_patch_backups/group6_dashboard_<时间戳>/`，失败时尝试恢复。不会覆盖 `.env`、`storage/`、账号数据库和上传文档，不需要 SQLite 迁移。
- 如遇 401：账号会话可能过期，请先正常登录，不能视为 API 500。完整 Vite 构建需在 Windows 端由 `npm.cmd ci` 安装完整依赖后运行。

## 本次测试记录（制包环境）

- 后端新增 5/5 通过（包括归属中间件），和第二、三组后端回归合计 15/15 通过；前端包含前五组测试 **43/43 通过**。
- TypeScript/TSX 语法解析通过（不等于 `tsc -b && vite build` 全量构建）。
- Windows 实机安装与完整 Vite 构建需要用户执行验证；结果以实际运行日志为准。
