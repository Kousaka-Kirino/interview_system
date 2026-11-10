# 代码结构与 Stage 命名清理说明

本次以用户最新源码为基线，执行**不改变业务流程**的结构整理。

## 规范化的 Python 模块

| 业务功能 | 当前模块 | 保留的旧导入兼容路径 |
|---|---|---|
| AI 复习知识点 | `app.knowledge_review` | `app.stage7_review` |
| 登录与账号管理 | `app.account_auth` | `app.stage8b_auth` |
| 资源归属隔离 | `app.ownership_guard` | `app.stage8c2_guard` |
| 语音识别 | `app.speech_transcription` | `app.stage9_speech` |
| PPTX 导入 | `app.pptx_import` | `app.stage10_pptx` |
| 账号目录和设置 | `app.account_storage` | `app.stage11_local` |
| 账号初始化 | `app.account_bootstrap` | `app.stage13_bootstrap` |

旧路径保留为导入别名，指向**同一个 Python 模块对象**，支持原有测试和猴子补丁。不要直接删除它们。

## 前端去 Stage 化

- 登录/个人资料弹层、语音面板和知识复习面板的 CSS 类名、HTML 标识改为按功能命名。
- `stage7c-dark.css` 更名 `reviewDark.css`；同时更新 TSX 引用。
- 内部面板锚点、DOM data 属性改为与业务相关的名称，CSS 与组件同步修改。

## 不应贸然改变的历史兼容数据

- SQLite 表 `app_stage8c2_meta`：已有本机数据库可能依赖。更名需要专门的数据迁移和回滚。
- localStorage 中的 `stage9c:*`、`stage9d:*` 和答题截止时间键：已有用户偏好依赖，仍原样保留。
- 账号数据库旧备份的 `stage13_auth_before_*`：属于历史数据文件命名，不应删除。
- `docs/` 中的历史 Stage 开发记录与 `stage12_import/`、`stage13_import/`：是溯源资料，不在运行路径中，保留以备审计。
- `_patch_backups/`、`storage/`：不是本次补丁对象，安装器不会读取或覆盖。

## 验证与边界

- `python -m pytest -q tests/test_clean_module_names.py tests/test_group12_cleanup.py tests/test_group11_local_presentation.py tests/test_group10_practice_modes.py tests/test_group9_training_loop.py tests/test_ai_review_group8.py tests/test_resume_corrections_group2.py tests/test_document_preview_group3.py tests/test_dashboard_score_history_group6.py tests/test_stage13_bootstrap.py`
- `npm.cmd run test:ui`、`npm.cmd run build`（完整 Vite 构建需在 Windows 有 node_modules 的环境验收）。
- 旧版全量后端测试包含不带登录态的接口测试，可能以 401/403 失败；**不能通过移除身份验证来解决**。
- 业务接口、认证权限、陈述先于提问的流程、向量模型路径和数据文件不变。
