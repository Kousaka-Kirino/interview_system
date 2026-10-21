# AI 模拟答辩陪练系统 — API_DOCUMENTATION.md

> 文档状态：历史文档遗失后的重建版（2026-10-16，Stage 5C）。
> 后端基础地址：`http://127.0.0.1:8000`。
> Swagger：`http://127.0.0.1:8000/docs`；OpenAPI：`http://127.0.0.1:8000/openapi.json`。
> 开发环境前端通过 Vite `/api` 代理访问后端，不必在浏览器代码写死 8000 端口。
> 文档仅包含接口、字段、约束、状态码、调用命令及流程，**不包含业务源码**。以本机 OpenAPI 及后端实际响应为最终准绳。

## 1. HTTP 接口总览

| Method | Path | Stage | 用途 |
|---|---|---|---|
| GET | `/api/health` | 0 | 后端健康检查 |
| GET | `/api/interviews/options` | 1A | 答辩配置选项 |
| POST | `/api/interviews/adaptation/preview` | 1A | 预览自适应难度调整 |
| POST | `/api/resumes` | 1B | 上传并解析简历 |
| GET | `/api/resumes` | 1B | 简历列表 |
| GET | `/api/resumes/{resume_id}` | 1B | 简历详情 |
| DELETE | `/api/resumes/{resume_id}` | 1B | 删除简历 |
| POST | `/api/materials` | 2 | 上传补充资料并建立向量索引 |
| GET | `/api/materials` | 2 | 补充资料列表 |
| POST | `/api/materials/search` | 2 | 搜索选定资料的文本片段 |
| DELETE | `/api/materials/{material_id}` | 2 | 删除资料与索引 |
| POST | `/api/interviews` | 3 | 创建会话、生成首题 |
| GET | `/api/interviews/{session_id}` | 3 | 会话及问答记录 |
| POST | `/api/interviews/{session_id}/answer` | 3 | 提交回答，生成评分、追问或下一题 |
| POST | `/api/interviews/{session_id}/finish` | 3 | 提前结束会话 |
| GET | `/api/interviews/history` | 4 | 答辩历史、分页、筛选 |
| GET | `/api/interviews/statistics` | 4 | 全局统计 |
| GET | `/api/interviews/{session_id}/report` | 4 | 离线规则报告 |
| POST | `/api/interviews/{session_id}/report/ai` | 4 | 可选 DeepSeek AI 报告/缓存 |

> Stage 5A～5C 全部是**前端接入**：未新增后端接口。路由顺序上应保证 `/history`、`/statistics` 不被动态的 `/{session_id}` 路由截获。

## 2. 一般约定

- 传输：JSON；上传文件为 `multipart/form-data`，表单字段固定为 `file`。
- `204 No Content` 无响应体，客户端不要强行按 JSON 解析。
- `404` 对象不存在，`409` 会话状态/题目冲突，`422` 参数校验失败，`503` 外部 LLM、Embedding 或索引服务不可用。
- SQLite 及向量文件在本机；调用 DeepSeek 时可能发送用户简历、回答及选中资料片段。
- 当前没有鉴权，API 仅供本机原型使用。

## 3. 基础/配置接口

### GET `/api/health`

- HTTP 200：`status`，可选 `service`。健康检查不代表 DeepSeek 可用。

### GET `/api/interviews/options`

- HTTP 200：`reviewer_styles`、`difficulty_levels`、`adaptation_levels`、`defaults`。
- 评委：`friendly` / `neutral` / `pressure`；难度整数 1～5；自适应整数 0～3。
- 配置其他约束：`question_count` 3～30、`max_followups` 0～2。

### POST `/api/interviews/adaptation/preview`

- 使用原 Stage 1A 后端约定：传入 `config`、上一题的评分及难度反馈，返回下一题难度和调整原因。
- 不创建会话，不调用 DeepSeek；具体请求细节可用本机 Swagger 校验。

## 4. 简历接口（Stage 1B / 前端 Stage 5B）

### POST `/api/resumes`

| 项目 | 约束 |
|---|---|
| Content-Type | `multipart/form-data` |
| 请求表单 | `file`，PDF 或 DOCX，可提取文字 |
| 大小 | 最多 8 MiB |
| 成功 | 201，`ResumeDetail` |
| 常见错误 | 413 超限、415 文件类型错误、422 空文件或无法解析 |

返回详情字段：`id`、`original_filename`、`file_size`、`created_at`、`full_text`、`structured_data`。上传时不调用 DeepSeek。

### GET `/api/resumes`

- HTTP 200：`ResumeInfo[]`；每项包含 `id`、`original_filename`、`file_size`、`created_at`。
- 空列表返回 `[]`，不包含原文。

### GET `/api/resumes/{resume_id}`

- HTTP 200：`ResumeDetail`，包含 `full_text` 和 `structured_data`；不存在 404。

### DELETE `/api/resumes/{resume_id}`

- HTTP 204：无响应体；不存在 404。
- 不建议删除仍被答辩会话使用的简历。

## 5. 补充资料与 RAG（Stage 2 / 前端 Stage 5B）

### POST `/api/materials`

| 项目 | 约束 |
|---|---|
| 请求 | `multipart/form-data`，表单字段 `file` |
| 文件 | PDF 或 DOCX，最多 12 MiB |
| PDF | 文字层，最多 150 页；提取正文最多 200000 字符 |
| 成功 | 201，`id`、`original_filename`、`file_size`、`chunk_count`、`created_at` |
| 失败 | 413/415/422；Embedding 或 Chroma 不可用时 503 |

首次使用本地中文模型可能要先联网下载模型文件；不需要 DeepSeek Key。

### GET `/api/materials`

- HTTP 200：`MaterialInfo[]`，含 `id`、`original_filename`、`file_size`、`chunk_count`、`created_at`；没有资料返回 `[]`。

### POST `/api/materials/search`

| 请求字段 | 类型 | 约束 |
|---|---|---|
| `query` | string | 必填，2～500 字符 |
| `material_ids` | string[] | 必填，1～10 个有效 ID |
| `top_k` | integer | 1～10，默认 5 |

- HTTP 200：`hits[]`，含 `material_id`、`original_filename`、`chunk_index`、`text`、`distance`。
- `distance` 是向量余弦距离，越小通常越相似，**不是相似度百分比**。
- 不存在的材料 ID 返回 404；参数错误 422；向量服务失败 503。

### DELETE `/api/materials/{material_id}`

- HTTP 204：无响应体；不存在 404；索引删除失败可返回 503。

## 6. 正式答辩（Stage 3 / 前端 Stage 5C）

### POST `/api/interviews`

- `Content-Type: application/json`，成功 `201 Created`。
- **服务端实际约定**为 `resume_id`、`material_ids` 和嵌套 `config`，不是旧 Stage 5C 草稿中扁平的 `interviewer_style` / `difficulty` / `adaptation_level`。

| 请求字段 | 类型 | 约束 |
|---|---|---|
| `resume_id` | string | 必填，存在的简历 UUID |
| `material_ids` | string[] | 可选，0～10 个资料 UUID |
| `config` | object | 可选，缺省采用后端默认配置 |

| `config` 字段 | 类型 | 约束 |
|---|---|---|
| `reviewer_style` | string | `friendly` / `neutral` / `pressure` |
| `initial_difficulty` | integer | 1～5 |
| `adaptation_level` | integer | 0～3 |
| `question_count` | integer | 3～30 |
| `max_followups` | integer | 0～2 |

成功响应是**完整会话**，不是扁平配置：`id`、`resume_id`、`material_ids`、`config`、`status`、`current_difficulty`、`main_questions_asked`、`followups_used`、`positive_streak`、`negative_streak`、`created_at`、`turns[]`。

`turns[]` 每项：`id`、`question_number`、`followup_number`、`difficulty`、`question`、`answer`、`score`、`feedback`、`user_feedback`。

- 创建时调用 DeepSeek 生成首题；未配置 API Key、模型失败或 RAG 索引故障可返回 `503`。
- `404` 简历/资料不存在；`422` 配置不合法。

### GET `/api/interviews/{session_id}`

- HTTP 200：与创建接口一致的会话结构；不存在 404。
- `status=active` 且最后一个 `turn.answer=null`：表示当前待答题。
- 已完成会话无需模型 Key 也能读取历史问答。

### POST `/api/interviews/{session_id}/answer`

| 请求字段 | 类型 | 约束 |
|---|---|---|
| `turn_id` | integer | 必填，当前待答题 `turns` 最后一项 ID |
| `answer` | string | 必填，去除空白后非空，最多 10000 字符 |
| `user_feedback` | string | `none` / `too_hard` / `too_easy` / `just_right` |

- HTTP 200：`session`（完整会话）及 `evaluation`（`score`、`feedback`、`adaptation_reason`）。
- 服务端负责评分、追问、难度调整、生成下一题；客户端不能自行传入模型评分。
- `409` 表示已提交、题目 ID 过期或会话结束；`503` 表示 DeepSeek 调用失败。
- 网络失败/超时后，**先 GET 会话确认是否已提交**，避免重复发送。

### POST `/api/interviews/{session_id}/finish`

- 无请求体；HTTP 200，返回完整 `SessionView`，`status=completed`。
- 可以重复调用；此接口**不生成复盘**。不存在 404。

## 7. 历史与复盘（Stage 4 / 前端 Stage 5A、5C）

### GET `/api/interviews/history`

| Query | 类型 | 默认 | 约束 |
|---|---|---|---|
| `status` | string | 不筛选 | `active` / `completed` |
| `limit` | integer | 20 | 1～100 |
| `offset` | integer | 0 | ≥0 |

- HTTP 200：`total`、`limit`、`offset`、`items[]`。
- `items[]` 每项：`id`、`resume_id`、`status`、`reviewer_style`、`created_at`、`answered_count`、`average_score`。
- 空列表返回 `items=[]`。

### GET `/api/interviews/statistics`

- HTTP 200：`total_sessions`、`active_sessions`、`completed_sessions`、`answered_turns`、`average_score`。
- `average_score` 是所有已评分回答的均值，无有效评分时为 `null`。
- 不需 DeepSeek Key。

### GET `/api/interviews/{session_id}/report`

- HTTP 200：只对已结束会话生成**离线规则复盘**；未结束返回 `409`；不存在 404。
- 字段：`session_id`、`status`、`reviewer_style`、`planned_main_questions`、`main_questions_asked`、`answered_count`、`unanswered_count`、`average_score`、`score_trend[]`、`turns[]`、`strengths[]`、`improvements[]`、`suggestions[]`、`ai_analysis`、`ai_generated_at`、`scoring_note`。
- Stage 5C 的完成页面使用此接口；无需 Key、不调用模型。

### POST `/api/interviews/{session_id}/report/ai`

- Query：`refresh=false` 默认读取缓存，`refresh=true` 请求重新生成。
- 成功 HTTP 200：与离线报告相同结构，但 AI 字段可包含生成内容。
- 首次生成需要 DeepSeek Key，可能产生成本。会话未结束 409；没有任何回答 422；模型不可用 503。

## 8. Windows API 验证命令

> 先启动 FastAPI；可在浏览器 `http://127.0.0.1:8000/docs` 使用 Try it out 完成 POST 请求的参数填写。

```powershell
curl.exe 'http://127.0.0.1:8000/api/health'
curl.exe 'http://127.0.0.1:8000/api/resumes'
curl.exe 'http://127.0.0.1:8000/api/materials'
curl.exe 'http://127.0.0.1:8000/api/interviews/statistics'
curl.exe 'http://127.0.0.1:8000/api/interviews/history?limit=8&offset=0'
```

> Stage 5C 流程：先有简历 → 配置页面 `#configure` → 创建成功取得会话 ID → `#session/{ID}` → 逐题回答 → 完成后离线报告。

## 9. 变更日志

- 2026-10-15：Stage 1B 简历 CRUD；Stage 2 材料 CRUD/RAG；Stage 3 正式答辩；Stage 4 历史统计及离线/AI 复盘。
- 2026-10-16：Stage 5A/5B 增加接口消费者，后端契约未变。
- 2026-10-16：Stage 5C 修正旧版不兼容的扁平配置草案。正式答辩继续使用 Stage 3 嵌套 `config`、1～5 难度、0～3 自适应和已有会话/回答接口；**没有新增或修改任何后端 HTTP API**。


<!-- STAGE5D_API_20261016 -->

---

## Stage 5D：前端历史与复盘接口消费约定（2026-10-16）

本次为**前端改进阶段**，不新增/修改后端 API，不修改 SQLite 表或后端字段。只明确现有 Stage 3/4 接口在前端的用途。API URL 均相对于 Vite `/api` 代理。

### 1. `GET /api/interviews/history`

| 参数 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `status` | string | `active` / `completed`；可省略 | 历史状态筛选 |
| `limit` | integer | 1～100 | 单页条数（前端默认 8） |
| `offset` | integer | ≥0 | 起始偏移 |

HTTP `200`：`total`、`limit`、`offset`、`items[]`。历史每项含 `id`、`resume_id`、`status`、`reviewer_style`、`created_at`、`answered_count`、`average_score`。`average_score` 可为 `null`。前端按 `status` 将会话链接到：

- `active` → `#session/{id}`
- `completed` → `#report/{id}`

`#session/`、`#report/` 是**前端 Hash 路由**，不属于 FastAPI 接口。

### 2. `GET /api/interviews/{session_id}`

HTTP `200`：返回 Stage 3 的完整 `InterviewSession`，包含答辩配置、状态和 `turns[]`。用来打开历史会话或恢复进行中会话；不存在返回 `404`。

### 3. `GET /api/interviews/{session_id}/report`

只允许已完成会话。HTTP `200` 主要字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `session_id` | string | 会话 ID |
| `status` | string | `completed` |
| `reviewer_style` | string | 评委风格 |
| `planned_main_questions` | integer | 计划主问题数 |
| `main_questions_asked` | integer | 实际发问数 |
| `answered_count` | integer | 已回答题目数（含追问） |
| `unanswered_count` | integer | 未回答数 |
| `average_score` | number / null | 已评分回答平均分 |
| `score_trend` | array | 每条已评分题目的 `turn_id`、`question_number`、`followup_number`、`difficulty`、`score` |
| `turns` | array | 已回答题目的题目、原始回答、得分和反馈 |
| `strengths` | string[] | 规则优势 |
| `improvements` | string[] | 规则改进点 |
| `suggestions` | string[] | 规则建议 |
| `ai_analysis` | object / null | 已缓存 AI 分析（若存在），只读 |
| `ai_generated_at` | string / null | AI 缓存生成时间 |
| `scoring_note` | string | 评分局限性提醒 |

未结束会话返回 `409`；不存在返回 `404`。**GET 只读取报告，不会触发 DeepSeek API 调用**。无已评分回答时分数可能为 `null`、趋势为空。前端不得把没有回答的题目当成 0 分。

### 4. `POST /api/interviews/{session_id}/report/ai?refresh=false`

- 请求：无 Body；**只在用户点击按钮并确认后调用**。不要在 React 页面首次加载时自动 POST。
- `refresh=false`：如已有缓存则复用；没有缓存时请求 DeepSeek 生成并缓存。
- `refresh=true`：无视原缓存重新生成，可能再次收费。前端必须提示并确认。
- HTTP `200`：返回与 `GET /report` 完全相同的报告外层结构，更新 `ai_analysis` 与 `ai_generated_at`。
- `ai_analysis` 主要包括 `summary`、`strengths[]`、`improvements[]`、`next_steps[]`；前端应容忍扩展字段。
- `404`：会话不存在；`409`：未结束；`422`：没有回答；`503`：DeepSeek Key 缺失或模型失败；`500`：保存 AI 结果失败。
- 费用与数据边界：模型调用可能消耗额度，并将答辩问题、回答、评分与反馈发送给第三方 DeepSeek。

### 5. 本地 TXT 导出

由浏览器使用已读取到的报告数据直接生成 `interview-report-{session_id}.txt`，**没有新增导出 HTTP API**；导出不需要 DeepSeek Key，且不额外上传任何数据。

### 6. 本机检查命令

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8000/api/interviews/history?limit=8&offset=0'
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:8000/api/interviews/statistics'
```

针对真实已完成会话 ID，再访问 `GET /api/interviews/{session_id}/report`；不建议仅为测试缓存而调用 AI POST，除非已经同意可能产生费用。

### 7. 本阶段 API 变更记录

- 2026-10-16：Stage 5D **不增加后端接口**。新增历史列表深链接、独立复盘 UI、导出和显式触发 AI 复盘的前端消费约定。

<!-- STAGE5E:BEGIN -->

## Stage 5E — 运行自检与会话恢复的 API 约定（2026-10-17）

**本阶段不新增后端 API，不修改既有请求/响应字段。** 所有自动状态检查及诊断都只使用已有 GET 接口，**不触发 DeepSeek 推理**。

| 方法 | URL | 使用场景 | 正常返回 |
|---|---|---|---|
| GET | `/api/health` | 前端每 30 秒检查后端连通性 | 200；`status="ok"` |
| GET | `/api/resumes` | 用户主动执行接口自检 | 200；简历摘要列表 |
| GET | `/api/materials` | 用户主动执行接口自检 | 200；材料摘要列表 |
| GET | `/api/interviews/statistics` | 用户主动执行接口自检 | 200；含 `total_sessions` |
| GET | `/api/interviews/history?limit=1&offset=0` | 用户主动执行接口自检 | 200；含 `total`、`items` |
| GET | `/api/interviews/{session_id}` | 检查最近会话的服务端保存状态 | 200；`status` 和 `turns` |

### 请求约束

- 检查请求在浏览器端 7 秒超时，仅提示错误，不自动重复发送写入请求。
- 自检输出只含路径、HTTP 结果、检查时间；不会打印简历、用户回答、模型提示词或 API Key。
- 最近会话通过页面 Hash（`#session/{id}`、`#report/{id}`）在浏览器本地保存其 ID；不传给其他第三方服务。
- 后端连通性状态和模型可用性是两回事；`GET /api/health` 为 200 不代表创建新答辩一定成功。
- 会话恢复只读 `GET /api/interviews/{session_id}`，不能代替通过 `POST /api/interviews/{session_id}/answer` 提交答案。
- 如果 `POST /answer` 返回超时或网络错误，先 GET 会话，确认原 `turn_id` 是否已被回答或是否进入下一题，再决定是否重试；避免重复提交造成 409。

### 常见状态

- HTTP 200：只读接口返回正常。
- HTTP 404：保存的会话 ID 在当前数据库中不存在，可能已删除或环境不一致。
- HTTP 503：非本阶段只读自检的预期正常值；如出现在材料相关接口，检查后端依赖。
- HTTP 500/502：后端错误或 Vite 代理无法连接；应检查 FastAPI 终端。
- 请求超时：页面显示超时提示，不对写入接口做自动重试。

### 本阶段验收命令

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\scripts\stage5e-smoke.ps1'
```

<!-- STAGE5E:END -->

<!-- STAGE6_REBRAND:BEGIN -->
## Stage 6 — 答辩训练命名兼容说明

### 接口路径保持稳定

以下路径**不因中文页面名称调整而变更**，前端继续按现有约定调用：

| 方法 | 路径 | 页面用途 |
| --- | --- | --- |
| GET | `/api/resumes` | 训练资料（原有简历记录）选择 |
| GET | `/api/materials` | 补充资料选择 |
| POST | `/api/interviews` | 创建答辩训练会话 |
| GET | `/api/interviews/{session_id}` | 获取答辩会话及问题 |
| POST | `/api/interviews/{session_id}/answer` | 提交答辩回答 |
| POST | `/api/interviews/{session_id}/finish` | 结束答辩 |
| GET | `/api/interviews/history` | 答辩历史 |
| GET | `/api/interviews/statistics` | 答辩统计 |
| GET | `/api/interviews/{session_id}/report` | 离线答辩复盘 |
| POST | `/api/interviews/{session_id}/report/ai` | 可选模型复盘 |

### 字段与兼容性

- `session_id`、`resume_id`、`material_ids`、`config`、`turns`、`question_count` 等请求/响应字段保持不变。
- 数据库与历史记录不会修改，也不会重新生成 ID。
- 继续兼容已有的 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` 等环境变量名，包括指向 Ollama 本地兼容接口的配置。
- 本阶段只更改固定中文文案和相关中文提示词。对答辩评分维度、论证质量、创新点与问答环节的真正业务适配留待后续阶段。
<!-- STAGE6_REBRAND:END -->

<!-- STAGE7_KNOWLEDGE_REVIEW_BEGIN -->

## Stage 7 — 答辩知识复习接口

所有新增接口以 `/api/study` 开头，继续通过 Vite 代理访问 FastAPI。不影响现有 `/api/interviews`、`/api/materials` 等路径。当前为无鉴权的本机单用户 API。

| 方法 | 路径 | 用途 | 是否更改数据 |
|---|---|---|---|
| GET | `/api/study/health` | 诊断 SQLite 复习库可用状态，首次调用会建表 | 可能初始化表 |
| GET | `/api/study/points?session_id=<id>` | 获取按会话筛选的知识点；不传 ID 则读取全部 | 否 |
| POST | `/api/study/points` | 保存知识点、重点标记、来源文字与评委追问取向 | 是 |
| PATCH | `/api/study/points/{id}` | 改变严重度、提问取向、重点、复习状态及备注 | 是 |
| DELETE | `/api/study/points/{id}` | 删除误保存的知识点 | 是 |
| GET | `/api/study/overview?session_id=<id>` | 获取雷达数据、风险热力图、薄弱点统计 | 否 |
| GET | `/api/study/search?query=...&material_ids=...&limit=8` | 只读扫描现有 Chroma 文本片段并进行关键词候选匹配 | 否 |

### 新建知识点的字段约定

- `title`：必填，最多 150 字；`session_id` / `material_id`：选填。
- `source_name`、`source_anchor`：来源名称及已有的页码或片段标识；如元数据缺失则为空。
- `source_text`：真实摘录片段，必填，最多 12000 字；`quote`：需要高亮的逐字子串，必填，最多 1200 字，且**必须包含在 `source_text` 中**，否则返回 HTTP 422。
- `dimension`：理论依据 / 论证逻辑 / 研究方法 / 数据证据 / 创新价值 / 答辩表达，默认理论依据。
- `orientation`：概念辨析 / 依据核验 / 方法追问 / 反例挑战 / 边界条件 / 应用延伸，默认依据核验。
- `severity`：1～5，数值越高越严重；`important`：布尔重点标记；`status`：`pending`（待复习）、`mastered`（已巩固）、`disputed`（不认可）。
- `note`：复习笔记或不认可理由，最多 3000 字。
- 成功创建返回 HTTP 201 和带 UUID 的完整对象；更新返回 HTTP 200，删除返回 HTTP 204，找不到记录返回 HTTP 404。

### 数据汇总与证据链

`GET /api/study/overview` 返回 `total`、`important`、`pending`、`mastered`、`disputed`、`radar`、`heatmap`、`top_risks`。`radar` 中维度未覆盖时 `value=null`，不会填写推测值。`heatmap` 的 `low/medium/high` 分别对应 1～2 / 3 / 4～5 级未巩固项。`source` 固定为 `local-user-annotations`。

`GET /api/study/search` 返回 `items`，每项提供索引来源、保存的原始文本、精确可高亮 `quote`、关键词匹配得分；本接口**并非问答模型实际引用证据列表**。若某场答辩 `material_ids` 与 Chroma 元数据无法匹配，可能返回空，前端提供手工录入兜底。

### 存储与部署

新增复习记录保存在项目根目录相对路径 `storage/data/study_review.db`，支持可选 `STUDY_SQLITE_PATH` 环境变量。与旧 SQLAlchemy 会话库独立，不要求迁移旧表。当前无需额外调用 Ollama/DeepSeek，且不会修改 `.env`。若需要未来做到“模型每次自动引用的原文”完整追溯，须对 Stage 3 的 RAG 检索调用链增加 `chunk_id` 与引用元数据回传，此项**不在 Stage 7 当前版本内**。

<!-- STAGE7_KNOWLEDGE_REVIEW_END -->

<!-- STAGE7B_DASHBOARD_LAYOUT_BEGIN -->

## Stage 7B - Dashboard-only layout update (no API changes)

This stage reorganizes existing dashboard presentation and **does not add, remove, rename, or migrate backend APIs, SQLite models, LLM configuration, or vector indexes**.

The radar chart, heatmap and knowledge-point list continue to use:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/study/overview` | Saved knowledge-point counts, per-dimension readiness and severity heatmap |
| GET | `/api/study/points` | Saved risk points and their source citations |
| PATCH | `/api/study/points/{id}` | Save importance, severity, questioning orientation, notes or mastered/disputed state |

The existing dashboard's historical scores and history cards retain their existing Stage 4 routes:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/interviews/statistics` | Existing aggregate/average scores |
| GET | `/api/interviews/history?limit=8&offset=0` | Existing historical entries and navigation |
| GET | `/api/interviews/{session_id}/report` | Existing offline review report |

All buttons and history entries keep the existing frontend/backend contract, including `/api/interviews` English URLs retained for backwards compatibility. The fifth card is a local UI toggle; clicking it does not create a new API request by itself.

The layout bridge does not alter original history items. If the history card labels or markup were heavily customized, it displays a visible non-destructive placement warning. Do not assume data loss or alter the database to fix a presentation mismatch.

<!-- STAGE7B_DASHBOARD_LAYOUT_END -->

<!-- STAGE7C_DARK_THEME_BEGIN -->

## Stage 7C — 深色仪表盘与登录预研

本次仅调整 React/CSS 显示，不变更任何后端 HTTP 接口；Stage 7 的 `/api/study/overview`、知识点检索、创建、更新和详情接口继续使用原有契约，持久化数据不变。

- `GET /api/study/overview`：继续供六维雷达图、风险热力图和复习计数读取数据。
- 风险等级、提问取向、重点标记、`pending/mastered/disputed` 状态仍沿用 Stage 7 的原有规则。
- Stage 7B 的顶部“历史答辩”按钮只负责切换已有历史列表的可见性，不额外创建、改写或删除答辩记录。
- 本次不实现认证接口，也没有部署数据库服务；以下是**计划接口，不可调用**。

### 未来账号认证接口（仅设计）

| 计划方法 | 计划路径 | 用途 |
|---|---|---|
| POST | `/api/auth/register` | 注册并校验账号输入（是否允许注册可配置） |
| POST | `/api/auth/login` | 验证凭据，建立服务端会话并设置安全 Cookie |
| POST | `/api/auth/logout` | 注销并使服务端会话失效 |
| GET | `/api/auth/me` | 获取当前已认证用户的非敏感信息 |
| POST | `/api/auth/forgot-password` | 规划本地密码恢复/管理员恢复策略，避免无验证的重置 |

认证/用户隔离与数据迁移尚未实现；上述路径属于未来设计，不应在 Stage 7C 期间认为可用。

<!-- STAGE7C_DARK_THEME_END -->

<!-- STAGE8A_OWNERSHIP_BEGIN -->

## Stage 8A — 账号归属结构及接口安全约定

### 本阶段未新增公网/HTTP API

Stage 8A 是停止 FastAPI 后运行的离线本地迁移。`/api/interviews`、`/api/resumes`、`/api/materials`、`/api/study/*` 等现有接口**目前保持旧行为**，并未因建立账号表而自动获得权限保护。

### 迁移新增的内部 SQLite 表（非 HTTP 接口）

| 表 | 职责 |
|---|---|
| `app_users` | 唯一用户名、用户 UUID、盐化密码派生值、首次改密标记 |
| `app_legacy_datasets` | 旧数据库中各业务表的初始归属及迁移时记录数 |
| `app_legacy_ownership` | 旧业务记录主键（或 rowid 快照）与初始用户 UUID 对应 |
| `app_file_ownership` | 旧上传文件相对路径、大小、SHA-256、初始用户 UUID |
| `app_vector_ownership` | 现有向量目录归属与待隔离迁移状态 |
| `app_stage8a_meta` | 迁移报告及安全状态 |

主数据库：由 `.env` 的 `SQLITE_PATH` 指定，默认 `storage/data/interview.db`；复习数据库使用 `STUDY_SQLITE_PATH`，默认 `storage/data/study_review.db`。

### 预定但尚未实现的 Stage 8B 认证 API

| Method | 计划地址 | 要求 |
|---|---|---|
| POST | `/api/auth/login` | 限流，登录后必须检查首次改密标记 |
| POST | `/api/auth/change-password` | 首次登录强制调用，不能绕过 |
| POST | `/api/auth/logout` | 服务器端会话撤销 |
| GET | `/api/auth/me` | 基于 Cookie 中的服务端认证会话获取当前用户 |
| POST | `/api/auth/register` | 仅在 Stage 8C 完成所有隔离验收后开放 |

所有业务路由将从 `current_user.id` 决定所有权；调用者自行提交的 `user_id` 不构成授权依据。跨账户访问报告、答辩、资料、知识点必须拒绝；Chroma 检索不允许跨集合。`aslan` 初始密码较弱，初次登录强制修改密码，且不能在任何日志、明文文件中记录。

<!-- STAGE8A_OWNERSHIP_END -->

<!-- STAGE8B_AUTH_BEGIN -->

## Stage 8B：本地认证 API（2026-10）

### 认证契约

- 后端仅接受本机来源；本阶段仅允许初始账号 `aslan`，注册接口尚未开放。
- 浏览器使用 `HttpOnly` Cookie（有效期 12 小时；生产 HTTPS 时启用 `Secure`）。Cookie 内为随机令牌，SQLite 只保存其 SHA-256 摘要。
- 所有私有 FastAPI 入口均需有登录会话；初始密码未修改前，普通业务入口不放行。所有修改操作要求允许的本机 `Origin`。
- `401`：没有有效会话 / 登录失败；`403`：必须修改初始密码或来源不被允许；`429`：登录尝试太频繁；`503`：账户 SQLite 未初始化或不可用。

| 方法 | 端点 | 输入 / 输出 | 备注 |
|---|---|---|---|
| GET | `/api/auth/me` | `{username, must_change_password, registration_enabled}` | 未登录返回 401；不泄露 ID 或密码哈希 |
| POST | `/api/auth/login` | `{username, password}` → 用户状态；设置 Cookie | 不提供注册，密码错误仅通用提示 |
| POST | `/api/auth/change-password` | `{current_password, new_password}` → 用户状态；刷新 Cookie | 必须登录；新密码至少 12 位；撤销其他会话 |
| POST | `/api/auth/logout` | `{}` → `{ok:true}`；删除 Cookie | 会话失效；需要本地 Origin |

### 现有 API 的行为变化

- `GET /api/health`、`GET /api/resumes`、`GET /api/materials`、`GET /api/interviews/history`、`GET /api/interviews/statistics`、`GET /api/study/overview` 均需要登录并完成改密后才能获取数据。
- 原有业务接口名称、参数和响应结构保持不变，未新增 `user_id` 查询参数。
- 浏览器经 `http://127.0.0.1:5173` 的 Vite `/api` 代理向 FastAPI 发请求，并自动携带同源 Cookie。不要从外部地址公开此本机开发服务。
- 之前的 `scripts/stage5e-smoke.ps1` 在无 Cookie 时得到 401 属于预期；新验收应先检查无登录 401，再用浏览器登录检查业务操作。
- 禁止浏览器指定任何 SQLite user_id、Chroma collection 或上传目录路径；后续 Stage 8C 在服务端绑定资源归属。

### 数据模型（新增部分）

| SQLite 表 | 存储内容 |
|---|---|
| `app_users` | Stage 8A 已有账号、哈希、密码重置状态；Stage 8B 更新改密状态 |
| `app_auth_sessions` | token 摘要、所属用户、创建时间、过期时间 |
| `app_auth_attempts` | 匿名化的来源+用户名键、失败次数、限制到期时间 |

**注意：Stage 8B 没有开放多账号数据隔离。** 所有旧资料仍归 `aslan`；Stage 8C 负责逐个业务接口权限校验和每用户私有向量集合。不要在 Stage 8C 之前增加第二个用户。

<!-- STAGE8C1_BEGIN -->
## Stage 8C-1 — 个人资料 API 与知识点归属

服务端仅允许本机访问，修改操作需允许的本地 `Origin`、有效 `HttpOnly` 登录 Cookie，且用户已完成 Stage 8B 首次登录密码更新。未登录返回 401，仍需首次改密返回 403。任何请求中的 `user_id` 都不作为所有权依据。

| 方法 | 路径 | 参数（JSON） | 返回 | 说明 |
|---|---|---|---|---|
| GET | `/api/auth/profile` | 无 | `{user_id,username,display_name,email,email_verified:false}` | 登录用户读取自己的资料 |
| PATCH | `/api/auth/profile` | `{ "display_name": "Aslan", "email": "test@example.local" }` | 更新后的用户资料 | 两个字段可分别提交；联系邮箱不发送验证邮件，用户名和 UUID 不允许修改 |
| POST | `/api/auth/profile/password` | `{ "new_password": "新的本地密码" }` | `{ok:true,message}` | 无需旧密码或验证码；仅要求非空、UTF-8 长度至多 256 字节；旧会话失效，当前会话获得新 Cookie |
| GET | `/api/study/points` | 可选 `session_id` | 用户自己的知识点列表 | 仅返回与当前会话 `user_id` 相同的记录 |
| POST | `/api/study/points` | 沿用 Stage 7 创建数据结构 | 新知识点 | 服务端填入 `user_id`；忽略/不采纳客户端自报归属 |
| PATCH | `/api/study/points/{id}` | 沿用 Stage 7 可编辑字段 | 更新的知识点 | 不属于登录用户的 ID 返回 404 |
| DELETE | `/api/study/points/{id}` | 无 | HTTP 204 | 不属于登录用户的 ID 返回 404 |
| GET | `/api/study/overview` | 可选 `session_id` | 雷达图、热力图、薄弱点统计 | 只计算登录用户知识点 |
| GET | `/api/study/search` | `query`,`material_ids`,`limit` | 仅旧用户归属内的候选片段 | 仍为 Stage 7 关键词候选搜索，不代表模型实际引用；第二账号检索尚未开放 |

注意：本阶段**没有实现**旧 `/api/interviews`、简历、材料、报告和上传目录的多用户逐资源隔离，因此 Stage 8B 的仅 `aslan` 登录限制仍保持。`/api/auth/change-password`（首次登录）仍要求原密码与 12 位新密码；本次免旧密码修改仅限已完成首次登录、具备有效会话的 `/api/auth/profile/password`。

<!-- STAGE8C1_END -->

<!-- STAGE8C2_BEGIN -->
## Stage 8C-2：资源所有权校验与数据库归属

本阶段**未新增面向前端的公共 HTTP 路由**，只增强现有 API 的资源访问检查。认证 Cookie 与本机来源限制沿用 Stage 8B；个人资料和知识点接口沿用 Stage 8C-1。

| 路由范围 | 新增的检查 |
|---|---|
| `GET /api/resumes/{id}` 及后续子路径 | 简历 ID 必须属于当前已登录账号，否则 404 |
| `GET /api/materials/{id}` 及后续子路径 | 资料 ID 必须属于当前账号，否则 404 |
| `/api/interviews/{session_id}`、`/answer`、`/finish`、`/report`、`/report/ai` | 答辩会话 ID 必须属于当前账号，否则 404 |
| `POST /api/interviews` | JSON 体内若提供 `resume_id`、`material_ids`，均必须属于当前账号，否则 404 |
| `POST /api/study/points` | 若指定 `session_id`、`material_id`，必须属于当前账号，否则 404 |
| `GET /api/study/search?material_ids=...` | 指定的材料 ID 必须属于当前账号，否则 404 |

后端以当前已认证 Cookie 为依据确定用户 ID；**不使用请求体传入的 `user_id` 来决定权限**。当账号归属数据库不可用时，接口默认拒绝相关请求（503），不回退为无限制访问。不存在的资源和没有归属权限的资源统一按 404 处理。

### 新增存储元数据（不对外提供 API）

- 主 SQLite 中明确识别的简历、补充资料、答辩会话主表增加 `user_id` 和相关索引。
- `app_stage8c2_meta` 记录三类主资源对应的实际表名、唯一用户 ID，以及 `multiuser_enabled=0` 标记。
- 单账号过渡期的插入触发器确保旧业务代码新建主记录时，临时归属到 `aslan`。后续多用户开放前必须移除这一策略。

### 已知不覆盖范围

- 历史列表、全局统计的数据库查询尚未直接添加用户条件；目前依赖 Stage 8B 只允许唯一账号来维持安全边界。
- 上传文件的实际读取路径与 Chroma 检索集合仍需改造；不能认为 Stage 8C-2 已完成跨账号数据隔离。
- `GET /api/study/health` 等无资源 ID 路由不属于本阶段的 ID 检查范围。
- 新注册和第二账号的登录依然关闭。

此文档记录接口权限语义，不包含 FastAPI/Python/TSX 的实现源码。
<!-- STAGE8C2_END -->

<!-- STAGE8D_NAVFIX_BEGIN -->
## Stage 8D — 账户导航布局说明

本次只调整浏览器导航栏位置，`AuthGate` 通过 React Portal 挂在“开始答辩”操作项后方，账户面板不再绝对/固定定位。登录、个人资料和退出操作仍使用现有 API；**接口与响应契约不变**。

| 请求 | 接口 | 说明 |
|---|---|---|
| GET | `/api/auth/me` | 当前登录用户 |
| GET | `/api/auth/profile` | 个人资料 |
| PATCH | `/api/auth/profile` | 更新昵称与联系邮箱 |
| POST | `/api/auth/profile/password` | 当前登录用户设置新密码 |
| POST | `/api/auth/logout` | 登出并撤销会话 |

安装/回滚只修改前端 `AuthGate.tsx`、`authGate.css` 和本文件及 `PROJECT_GUIDE.md`，不触碰认证数据库与存储数据。
<!-- STAGE8D_NAVFIX_END -->

<!-- STAGE9_VOICE_TIMER_BEGIN -->
## Stage 9 — 本地语音转写接口

### POST `/api/speech/transcribe`

- **认证**：必须携带与既有 Stage 8B 登录一致的本机会话 Cookie；未登录返回 401，首次强制改密前返回 403；写请求仍受现有 Origin/CSRF 检查。
- **请求**：`multipart/form-data`；字段 `file`，包含浏览器录音文件（webm / ogg / mp4 / m4a / wav / mp3）。
- **限制**：音频文件最大 18 MiB，长度约 125 秒以内；模型 CPU `base`，中文 `zh`，默认临时文件删除。
- **成功响应**：JSON 字段 `text`（UTF-8 转写内容）、`language`（固定 `zh`）、`duration_seconds`（录音时长）。
- **错误码**：401/403 认证或密码变更未完成、413 文件/时长超限、415 格式不支持、422 音频或识别失败、503 模型未安装/无法加载。
- **副作用**：不会写入会话答案、不保存永久录音。第一轮下载 Whisper 权重可能需要联网；模型与 Ollama 相互独立。

### 既有答辩 API 复用

- `GET /api/interviews/{session_id}`：读取 status 和 turns；客户端寻找最后一条 `answer == null` 或空串的题目，创建并持久化本地 120 秒计时。
- `POST /api/interviews/{session_id}/answer`：传入 `turn_id`、`answer`、`user_feedback="none"`；正常语音文本经用户手动确认后提交，超时跳过则传入明确的跳过标记字符串。
- **注意**：跳过现阶段不是专门的独立 API，而是兼容原回答接口；原算法可能对标记字符串评分。不要把跳过分数解释为真实能力表现。
- 计时截止时间由前端 localStorage 维护（以本机浏览器首次看到题目的时间为起点），非服务器裁定。

本阶段无表结构变更，`/api/speech/transcribe` 不依赖 Ollama、DeepSeek API Key 或新增数据库服务。
<!-- STAGE9_VOICE_TIMER_END -->

<!-- STAGE9B_LAYOUT_BEGIN -->
## Stage 9B: UI-only placement correction

No API schemas or endpoint paths changed. `POST /api/speech/transcribe`, `GET /api/interviews/{session_id}` and `POST /api/interviews/{session_id}/answer` retain their Stage 9 contracts. Stage 9B changes only the DOM mounting location of the countdown/voice input to sit next to the original answer textarea. No new backend data, permissions or storage settings are introduced.
<!-- STAGE9B_LAYOUT_END -->

<!-- STAGE9C_DURATION_BEGIN -->
## Stage 9C — Client-side defense timer configuration

This stage **does not change backend request or response schemas**. The existing `POST /api/interviews`, `GET /api/interviews/{session_id}`, `POST /api/interviews/{session_id}/answer`, and `POST /api/speech/transcribe` remain unchanged.

The new configuration value `answer_minutes` (conceptual only; not sent as an API field) is an integer in `0..60`. It is stored on the client per session in browser `localStorage`. `0` disables the per-question timer, while `1..60` selects a countdown. The default for sessions without a stored choice is `2` minutes.

**Scope and limitations:** no backend time enforcement, no cross-browser synchronization and no database persistence. The speech transcription API still restricts one recording to about 2 minutes and to the existing file-size cap; a longer answer needs multiple recordings. Auth, resource ownership, scoring and the API contracts are not altered.
<!-- STAGE9C_DURATION_END -->

<!-- STAGE9D_DUAL_DURATION_BEGIN -->
## Stage 9D - Two browser-side timing settings (no API changes)

| Field | Storage key | Default | Valid values |
|---|---|---:|---|
| Per-question minutes | `stage9c:minutes:{session_id}` | 2 | Integer 0-60 |
| Whole-defense minutes | `stage9d:total-minutes:{session_id}` | 0 (unlimited) | Integer 0-60 |
| Per-question deadline | `stage9:deadline:{session_id}:{turn_id}` | N/A | Unix epoch milliseconds |
| Whole-defense deadline | `stage9d:total-deadline:{session_id}` | N/A | Unix epoch milliseconds |
| Total-time continue flag | `stage9d:total-continue:{session_id}` | false | `1` if user selected continue |

- The client reads the current unanswered question using authenticated `GET /api/interviews/{session_id}`.
- Speech input remains authenticated `POST /api/speech/transcribe` (multipart audio).
- Answer/skip remains `POST /api/interviews/{session_id}/answer` with existing `turn_id`, `answer`, `user_feedback` contract. Skip is still sent as text; original scoring may count it.
- On user choice to finish the whole defense, the browser calls `POST /api/interviews/{session_id}/finish` (no body), then reloads the session. It does **not** submit any outstanding draft automatically.
- Timers and configuration are browser-local; there is no new backend API, schema, or server validation of the minute limits.
<!-- STAGE9D_DUAL_DURATION_END -->

<!-- STAGE9E_COMPACT_LAYOUT_BEGIN -->
## Stage 9E - Configuration layout integration (no API contract changes)

- Frontend configuration route: `#configure` or `#interview`; timer settings now appear inside the left materials-selection column when the standard two-column DOM is found.
- The fields are **per-question minutes (0-60, default 2)** and **whole-defense minutes (0-60, default 0)**. `0` disables its corresponding timer.
- Values continue to use the existing browser localStorage keys and are bound to a newly created session when the route changes to `#session/{id}`. No timer data is added to backend request schemas in this stage.
- Existing API calls remain unchanged: `POST /api/interviews`, `GET /api/interviews/{session_id}`, `POST /api/interviews/{session_id}/answer`, `POST /api/interviews/{session_id}/finish`, and `POST /api/speech/transcribe`.
- No database migration or HTTP change is required. The timers remain client-side only; the server does not enforce their expiration.
<!-- STAGE9E_COMPACT_LAYOUT_END -->

<!-- STAGE9F_BALANCED_LAYOUT_BEGIN -->
## Stage 9F — 纯前端布局调整

- 本阶段没有新增、删除或修改任何 HTTP API。
- `POST /api/interviews` 创建会话的 JSON 协议保持不变。
- `POST /api/speech/transcribe` 语音转文字接口保持不变。
- 每题计时与整场计时沿用 Stage 9D/9E 的前端设置和会话本地持久化方式；0 表示不限时，允许 0～60 整数。
- 本阶段只调整原有输入组件的显示排列和自适应高度，仍应验证创建会话及计时没有回归问题。
<!-- STAGE9F_BALANCED_LAYOUT_END -->

<!-- STAGE10_PPTX_BEGIN -->
## Stage 10 — PPTX 资料兼容上传接口

| Method | Path | 登录 | 说明 |
|---|---|---|---|
| POST | `/api/materials/pptx-import` | 必须 | 上传 `.pptx` 并转换为 DOCX 文字副本，再进入既有资料索引流程 |

- Content-Type：`multipart/form-data`，字段名 `file`；支持 `.pptx`，大小至多 12 MiB，至多 150 张幻灯片及 200,000 个可提取文字字符。
- 旧格式 `.ppt` 不支持；空白/全图片型 PPTX 不能提取有效文字，返回 422。
- 成功时返回与既有 `POST /api/materials` 相同的 `MaterialInfo`，状态为 201；`original_filename` 将显示**生成的文字版 `.docx` 文件名**，以避免误认为原始 PPTX 已原样保存。
- 典型失败：401 未登录；413 文件过大；415 格式不受支持；422 文件损坏或不含可提取文字；原资料上传服务的其他错误码会原样返回。
- 原有 `GET /api/materials`、`POST /api/materials/search`、`DELETE /api/materials/{material_id}` 无契约改动；仍使用材料 ID 检索与删除。
- 文本页码以“第 N 页”标题写入转换文本。检索结果的 `chunk_index` 是文本分块编号，**不能直接当作幻灯片页码**。
- 导入过程中仅处理文字，不解析图片和图表，不存储原始 PPTX 文件；转换过程只在请求期间占用内存。
<!-- STAGE10_PPTX_END -->


<!-- stage10d-pptx-route-fix -->
## Stage 10D：PPTX text import endpoint

- `POST /api/pptx-import`（`multipart/form-data`，字段 `file`，要求已登录）：上传 `.pptx` 文本型演示文稿；转换为含页码的 DOCX，复用已有资料索引。
- 保留旧兼容地址 `/api/materials/pptx-import`，但它可能与资料 ID 处理路径冲突，前端不使用。
- 非法或损坏文件、文件过大、旧版 `.ppt` 仍由 Stage 10 原有校验拒绝。
- 不更改数据库结构；转换版 DOCX 被保存，原始 PPTX 不保留。
