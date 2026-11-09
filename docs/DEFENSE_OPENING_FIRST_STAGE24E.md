# Stage 24E · 项目答辩先陈述后出题

**来源**：基于 `Kousaka-Kirino/interview_system` 当前公开 `main` 分支的 Stage 24 系列代码接口。仅改答辩模式出题时序、前端陈述阶段和相关测试；面试模式保持原样。旧场次不自动迁移。

## 正确的业务时序

1. 在“开始答辩”选 **项目答辩模式**、已建立文字索引的 PPT / 论文等材料。
2. 创建会话：后端只验证材料和检索索引，不调用 AI 出第一道题；该会话 `main_questions_asked=0`、`turns=[]`、`opening_required=true`、`opening_completed=false`。
3. 答辩者在幻灯片展示区翻页、完整陈述；可以用本机 Whisper 分段转写，也可以手动输入陈述文字。答题框和答题倒计时暂时不显示。
4. 答辩者主动点击 **“结束陈述并生成第一题”**，后端读取陈述文字和当前账号的 PPT/资料 RAG 片段，交给 AI 生成陈述反馈和第一道问题。
5. AI 成功后**在同一事务中**存储分析和第一道题。返回会话后可见题目，才开始答题倒计时。
6. 如果大模型调用失败，不出现题目，不保存假反馈，可修改陈述后重试。

## 新接口字段

`GET/POST /api/interviews`、`GET /api/interviews/{id}` 的 `SessionView` 新增：

```json
{"opening_required": true, "opening_completed": false, "main_questions_asked": 0, "turns": []}
```

`GET /api/interviews/{id}/opening` 继续返回 `completed/analysis`；
`POST /api/interviews/{id}/opening` 接受 `{"text":"至少30字的完整陈述"}`，响应分析含 `followup_question`。原有 URL 不变。

- 新答辩会话的 `POST /api/interviews/{id}/answer` 在陈述分析尚未保存时返回 **409**；阻止前端直连绕过。
- 有效陈述和资料片段由后端结合；不能只传 PPT 文件名。AI 可能产生费用，且问题质量受到索引文字完整度影响。
- 老的 `opening_required` 缺失的会话维持原有状态，可继续未完成的历史练习。
- 不更改 SQLite 表结构，不清除旧账号、PPT、答辩数据。
- 口头陈述是否真正结束，只能由答辩者点击按钮主动确认；系统不会在计时满 5 分钟后强制生成问题。

## 安装与测试

先关闭 FastAPI 与 Vite；在项目 `C:\Users\Kirino\Desktop\interview_system` 运行补丁预检查、安装。参见包中 `README.txt`。

```powershell
$project='C:\Users\Kirino\Desktop\interview_system'
$python=Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_group10_practice_modes.py tests/test_group11_local_presentation.py
Set-Location (Join-Path $project 'frontend')
npm.cmd run test:ui
npm.cmd run build
```

**重点验收**：新答辩会话创建后，检查浏览器 Network：创建接口不能发生第一题生成；应显示 0 道题。完成陈述后再出现第一题。原面试模式应仍然直接生成首题。

**失败保护**：安装器对所需文件做锚点匹配，任何一个文件不符合预期则停止。正式安装前备份到 `_patch_backups/stage24e_opening_*`。不会读取或修改 `.env`、API Key、`storage/`。

## Stage 24E v3 安装兼容性修正

在 v2 的 Windows PowerShell 编码修复基础上，v3 修复了 `frontend/src/types/interview.ts` 的严格文本锚点问题：现在定位 `InterviewSession` 接口及字段名，保留本地额外字段，避免因 `practice_focus` 的格式变化而拒绝安装。已有且类型正确的 `opening_required` / `opening_completed` 不会重复插入。所有目标文件在安装前先进行只读预检查；不兼容项目一次列出全部冲突路径，不会尝试强行写入。

未改变“先完成自我陈述、再根据 PPT 文字索引和陈述生成第一题”的业务行为；仍然不会修改用户数据库或模型配置。v3 可直接替代 v1/v2 安装，不需要先运行旧版。
