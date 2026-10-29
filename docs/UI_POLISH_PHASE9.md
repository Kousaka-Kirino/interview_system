# Stage 22 · 第九组：自动复盘、结束页收口与薄弱点专项训练

对应《系统优化方案》第 **3、17、18 项**。本次不做 PPT 逐页视觉理解、双模式及独立语音故障修复。

## 一、交付范围

### 3. 答辩结束后自动 AI 复盘（需主动开启）
- 使用第八组原有账号偏好 `interview_system:auto_ai_review:<用户名>`，默认关闭。
- 用户在**答辩复盘页**主动勾选后，后续答辩正常完成/点击提前结束/计时器结束，会在会话页第一次确认完成状态时调用原有 `POST /api/interviews/{id}/report/ai?refresh=false`。
- 需要本机浏览器持续打开、后端可用；不是后台队列任务。如果页面关闭或自动请求失败，可在复盘页手动补生成。
- 结束标记放在当前浏览器会话的 `sessionStorage`，历史会话被普通打开不会触发新的自动生成。没有已提交回答时不生成。单场自动流程仅尝试一次；用户手动刷新生成仍可继续。
- 已保存 AI 缓存的请求不会重复调用模型；同一单进程 Uvicorn 工作进程内，并发请求通过按账号+会话的锁串行，避免双标签页同时首次生成。**多工作进程、多机器部署不保证这一锁跨进程生效**；此本机单进程部署受支持，不应多开独立 FastAPI 后端。显式“重新生成”仍可能付费。
- 真实 DeepSeek 调用属于付费操作，自动设置需明确勾选；仅用户自己管理 `.env`，补丁不含 API Key。

### 17. 结束页精简
- 答辩会话页的结束面板只展示已答/未答/平均分和一个醒目的“查看完整复盘与导出”按钮；不再重复铺开优势、待加强和建议。
- 规则与 AI 详细复盘统一在独立的复盘页显示。原有评分记录和导出功能不变。

### 18. 薄弱点驱动再练
- 复盘页已生成**有据可依**的 AI 薄弱点时，出现“针对 N 个薄弱点专项再练”。普通“沿用本场资料再练一次”仍可用。
- 跳转 `#configure/focus/<原会话ID>`，按原有第七组逻辑恢复仍可用的简历、材料和练习设置，用户检查后点击“开始答辩”。进入配置页本身不调用模型。
- 新建会话请求可选择 `focus_session_id`，后端在**当前账号独立 SQLite**中查找已完成原会话与已缓存的 AI 复盘，筛选锚定真实已答题且**分数低于80**的薄弱点，按维度+标题去重，最多3条。不允许客户端直接传任意薄弱点。原简历必须一致，缺原会话或缺有效复盘会拒绝创建，且不调用额外复盘模型。
- 仅把经过验证的维度/标题/原因作为下一场的出题参考，传入首题和后续追问。模型仍可能偏离重点：这属于提示词约束，不承诺100%命中。
- 复盘页记录本场专项重点和来源；原场次数据不修改，不复制回答/评分。原数据库沿用 `interview_sessions.config_data` JSON 存储本次训练元信息，**不新增表**。
- “提升追踪”目前仅有训练来源与本场成绩，可手动比较总体平均分；因不同时期题目不同，**不宣称实现逐维度客观能力涨幅测量**。

## 二、主要改动

- `backend/app/services/focus_practice.py`：服务端校验原会话与有效弱点。
- `backend/app/services/review_lock.py`：本地单进程首次 AI 生成并发互斥。
- `backend/app/api/sessions.py`、`backend/app/services/deepseek_interview.py`：专项请求与模型出题指引。
- `backend/app/api/reports.py`、`backend/app/services/report_service.py`、`backend/app/schemas/{session,report}.py`：缓存与训练来源展示。
- `frontend/src/lib/autoReviewPreference.ts`、`frontend/src/components/speech/DefenseVoiceTimer.tsx`、`frontend/src/pages/InterviewSessionPage.tsx`：明确开启后的完成触发和结束页精简。
- `frontend/src/App.tsx`、`frontend/src/pages/InterviewConfigPage.tsx`、`frontend/src/pages/InterviewReportPage.tsx`：专项入口、确认页与训练说明。
- `frontend/tests/training-loop-group9.test.mjs`、`backend/tests/test_group9_training_loop.py`：独立数据回归测试。

## 三、测试

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_group9_training_loop.py tests/test_ai_review_group8.py tests/test_resume_corrections_group2.py tests/test_document_preview_group3.py tests/test_dashboard_score_history_group6.py
Set-Location (Join-Path $project 'frontend')
npm.cmd run test:ui
npm.cmd run build
```

第九组开发环境验证：后端 **25/25**，前端 **64/64**；改动过的 TypeScript/TSX 语法检查和 Python 编译检查通过。由于构建依赖在交付环境不完整，**Vite 全量构建需要 Windows 本机执行**。

## 四、手工验收场景

1. 自动开关默认关闭：正常结束不自动调用模型；在复盘页明确勾选后，下一场有回答的答辩结束应提示自动生成。
2. 同一场缓存复盘重复打开不再生成；显式重新生成会提示可能再次计费。
3. 有有效薄弱点的 AI 复盘提供普通再练与专项再练；无 AI 缓存或低分薄弱点不提供专项按钮。
4. 专项再练配置页允许核对、更改题量/时间；正常开始后产生新 ID，来源不变。
5. 在复盘页查看本场专项重点、来源；切换账号不能读取另一个账号的原场次。
6. 实测异常（模型服务不可用、网络断线）应留下原答辩评分与本地规则复盘，且可手动重试 AI 复盘。

## 五、安装约束

前置：Stage 21 Group8 v2 已安装。离线安装器 DryRun 预检查发现不匹配会尝试 `git merge-file` 三方合并；修改重叠则停止，不进行强制覆盖。正式安装先备份，写入失败尽力回滚。仅包含源码、文档、测试；绝不包含 `.env`、模型、SQLite、用户数据或密钥。
