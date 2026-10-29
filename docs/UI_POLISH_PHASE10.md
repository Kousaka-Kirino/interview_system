# Stage 23 · 第十组：面试 / 项目答辩双模式基础架构

对应《系统优化方案》最后 7–9 页提出的双模式：**模式切换放在“开始答辩”顶部**，不新增导航页。

## 已实现

1. **面试模式**（默认，兼容已有流程）：必选一份真实简历，可以补充最多十份资料。生成和评分提示词侧重个人经历、技能和项目经历。
2. **项目答辩模式**：无需简历，必须从“我的材料”中选至少一份成功建立索引的 PPTX 文字提取版、PDF 或 DOCX。后端以选中材料的文件名构造检索查询，并要求 RAG 返回合格的文本片段，才会调用原有 AI 生成首题。LLM 指令按项目答辩模式编排；后续提问和评分也保留模式。
3. 模式写入现有 `interview_sessions.config_data.practice_mode`（不新增字段/表）；读旧记录时缺省视作 `interview`。接口 `POST /api/interviews` 接受可选 `mode`，兼容原有只带 `resume_id` 的请求。
4. 配置页顶部提供两个按钮，`aria-pressed` 标记当前模式。面试显示简历选择，答辩隐藏简历选择、强调必选资料。模式偏好按当前账号的浏览器 localStorage 键存储；旧配置预设、题量、计时和评分逻辑不变。
5. 会话页、复盘页和历史列表显示模式；普通再练和已有薄弱点专项再练保留模式，仍需用户确认配置后创建新场次。
6. 兼容旧表 `interview_sessions.resume_id NOT NULL`：答辩无简历时，仅在首次问题生成成功之后，在**该用户个人数据库**中创建一条带 `_internal_defense_context` 标记的内部上下文 Resume 记录作为外键占位。该记录没有原始上传文件、不代表用户提交过简历、被简历列表以及简历 CRUD 路由隐藏，旧表无需迁移。实际完整项目材料保存在原有 Material/Chroma 中，内部行仅包含材料名称和模式提示。

## 限制与风险

- **第十一组才做**：PPT 页码、图片/图表视觉理解、5–8 分钟自我陈述及按陈述逐页追问。当前 PPTX 仍然是文字提取版，不能声称读到幻灯片上的图片或图表。
- **材料索引必须可用**：如选中资料虽存在但无法检索到符合现有相关性阈值的文本片段，返回 422，不创建会话、不调用出题模型；请先到“我的材料”检查可选中文字和索引。
- 内部上下文记录与答辩会话一起存储于用户业务 SQLite。后续如果设计删除会话的功能，可专门清理失去关联的内部行；本组不会清理或迁移旧数据库。
- 模型仍可能未完全遵循来源材料；AI 复盘、评分和题目仅供练习参考。
- 有效素材片段会发送到 `.env` 配置的模型服务；若采用 DeepSeek 云端，可能产生 API 调用费用。仅点击模式切换不调用模型。
- 旧的 `aslan` 历史数据库可能存在额外所有权约束；这部分未在真实历史数据库上执行写入验证，安装后应采用普通账号先实测。
- 语音识别依赖问题（PyAV / 麦克风静音）不在本组，仍按独立诊断结果处理。

## API 变化

`POST /api/interviews` 示例：

```json
{"mode":"defense","material_ids":["<已有资料UUID>"],"config":{"question_count":3,"max_followups":0}}
```

`mode = "interview"` 时 `resume_id` 必填；`mode = "defense"` 时 `material_ids` 至少 1 项，`resume_id` 不需要提交。

`GET /api/interviews/{id}`、答辩报告、历史列表新增 `mode`（`"interview" | "defense"`），旧记录默认返回 `interview`。`resume_id` 在答辩模式是数据库内部兼容标识，不是可用简历接口的资源。

## 安装和测试

前置 Stage 22 第九组安装成功。补丁安装脚本先 DryRun 计算文件哈希与离线合并结果，非冲突更改保留；存在重叠时停止；正式安装前备份到 `_patch_backups`，失败时尝试回滚；**不包含 `.env`、API Key、用户数据或数据库文件**。

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_group10_practice_modes.py tests/test_group9_training_loop.py tests/test_ai_review_group8.py tests/test_resume_corrections_group2.py tests/test_document_preview_group3.py tests/test_dashboard_score_history_group6.py
Set-Location (Join-Path $project 'frontend')
npm.cmd run test:ui
npm.cmd run build
```

本交付环境独立回归：后端 31/31，前端新增模式测试后 72/72；Python 编译及改动 TypeScript/TSX 语法检查通过。**本环境 npm ci 无法完成，因此尚未通过完整 Vite 构建，请在 Windows 电脑上验证。** 模拟模型测试不会消耗 DeepSeek 配额。

## 手工验收

1. 旧面试流程仍需简历；历史面试记录可打开、查看复盘和再练。
2. 在“开始答辩”顶部切至答辩模式，不选简历，仅选一份已成功索引的项目资料即可开始；进入会话后应标为“项目答辩”。
3. 不选资料时开始按钮禁用；资料无索引时后端拒绝并给出说明。检查简历列表不会出现“系统内部项目上下文”。
4. 答辩完成、查看复盘和普通再练时保留答辩模式和材料；旧的练习计时正常。
5. 使用另一个账号登录后，不应读取第一个账号的内部上下文与材料。
