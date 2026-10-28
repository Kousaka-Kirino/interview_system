# 第二组：简历中文字段、人工修正与答辩前健康度提示

- 日期：2026-10-27
- 基线：Stage 13 源码 + 第一组 UI 补丁 v2（已安装版本）
- 需求：优化方案第 4、5、12 项
- 本轮不涉及：第 3、17、19、20 项及双模式 AI 逻辑；不增加 LLM 调用；不迁移、删除或重建已有数据库。

## 变更清单

| 需求 | 行为 | 相关文件 |
|---|---|---|
| 4 | 七个固定章节用中文显示；增强标题匹配（教育背景/实习经历/科研经历/获奖情况/其他等），支持“项目经历：文本”同行解析 | `backend/app/services/resume_parser.py`、`frontend/src/pages/ResumesPage.tsx` |
| 5 | 上传后直接修改姓名、邮箱、电话及七个章节；PATCH 保存到 `structured_data`，不覆盖 `full_text` 或文件；低完整度时显示建议 | `backend/app/api/resumes.py`、`backend/app/schemas/resume.py`、`frontend/src/pages/ResumesPage.tsx` |
| 5 | 新建答辩与后续回答评分/追问优先读取人工核对后的信息；原文仅作为参考 | `backend/app/services/resume_parser.py`、`backend/app/api/sessions.py` |
| 12 | 创建答辩时显示选中简历的 `x/7` 章节完整度；项目、实习或技能缺失提示；“去补全”直达所选简历 | `frontend/src/pages/InterviewConfigPage.tsx`、`frontend/src/App.tsx` |
| API | 简历列表、上传及详情响应增加 `quality`; 新增 `PATCH /api/resumes/{id}` | `backend/app/api/resumes.py`、`frontend/src/lib/api.ts`、`frontend/src/types/resources.ts` |
| 文档 | API 接口、前端 README 和本文件同步更新 | `API_DOCUMENTATION.md`、`frontend/README.md`、`docs/UI_POLISH_PHASE2.md` |
| 测试 | 新增 4 项隔离后端测试与 4 项前端契约测试 | `backend/tests/test_resume_corrections_group2.py`、`frontend/tests/resume-corrections.test.mjs` |

## 设计与兼容说明

1. **无数据库结构迁移**：新数据保存在已存在的 JSON 字段 `Resume.structured_data`，人工核对标记为 `manual_reviewed`。旧记录（没有该标记）进入模型前保持原来的 `full_text` 行为。
2. **用户数据不共享**：复用 Stage 13 的本地登录中间件、资源归属校验及用户独立数据库；接口按当前账号的 `get_db` 获取数据。补丁不包含 `storage/`、`.env`、真实简历或模型文件。
3. **原文保持只读**：上传原始文件不被编辑覆盖；原始提取文本保留。人工修正后的内容在模型上下文最前面，原文随后作为参考。如果两者矛盾，提示以人工核对版本为准。
4. **健康度不等于识别准确率**：七章节 `profile/education/experience/projects/skills/awards/other` 中有非空文字的章节计数（profile 还考虑姓名/联系方式）。可显示 `2/7`，但不得声称这是 OCR 准确率或语义识别率。缺失的章节不会凭空补写。
5. **不会阻止开始答辩**：提示低完整度及核心章节缺失，但允许用户继续。用户可以随时返回编辑。
6. **导出/原文预览**：属于第三组，尚未实施。

## Windows 安装与验证

先停止 FastAPI / Vite。使用修正版安装脚本（先 DryRun，全部文件通过基线校验后才正式安装）。安装器备份每一个将覆盖的原文件；遇到本地修改不强制覆盖；失败时回滚。路径见补丁包 README。

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$python = Join-Path $project '.venvs\interview_system\Scripts\python.exe'
Set-Location (Join-Path $project 'backend')
& $python -m pytest -q tests/test_resume_corrections_group2.py
if ($LASTEXITCODE -ne 0) { throw '简历回归测试失败' }
Set-Location (Join-Path $project 'frontend')
npm.cmd run test:ui
if ($LASTEXITCODE -ne 0) { throw '前端契约测试失败' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'TypeScript/Vite 构建失败' }
```

**验收流程**：用自己的账号登录 → 上传一份项目章节未识别的 DOCX/PDF → 查看中文章节与健康度 → 对照原始文本补充真实项目/技能 → 保存 → 刷新后再次打开确认持久化 → 开始答辩选择该简历，确认健康度更新 → 正常出题/回答；退出、切换账号时不应看到其他人的资料。

## 测试范围与当前限制

- 本轮隔离回归测试使用临时 SQLite、临时上传目录和假的 AI/RAG 对象，不向真实模型发送请求、不访问真实用户资料。
- `test_resume_corrections_group2.py` 覆盖：中文标题解析、上传/修正/持久化、修正内容进入新会话提问和评分、非法字段/大小限制、历史简历兼容。
- 前端 `resume-corrections.test.mjs` 对中文名称、编辑保存调用、x/7 解释、答辩页跳转做静态契约检查；它不等同于浏览器 E2E 测试。
- **仓库原有的部分 `backend/tests/test_resumes.py`、`test_sessions.py` 仍按早期无登录阶段的规则编写**，在 Stage 13 实际中间件下可能收到 401/403。不要因为这批旧测试失败就禁用生产鉴权；本轮新增测试用隔离应用验证业务逻辑。
- 本开发环境可运行 Python 回归、Node 内置测试及 TSX 语法检查，但无法完成依赖不完整环境中的 Vite 全量构建。**最终 `npm.cmd run build` 必须在你的 Windows 项目里执行**，未通过则不要视为完整验收。

## 安装兼容性：v2 三方合并补丁（2026-10-27）

- 第一版补丁严格比对 14 个文件的 SHA-256；因用户本地四个文件与制包基线不同，安装器已拒绝修改。
- v2 仅对 `backend/app/services/resume_parser.py`、`backend/app/api/sessions.py`、`backend/app/schemas/resume.py`、`API_DOCUMENTATION.md` 使用**离线三方合并**。其余十个文件仍维持原来的 SHA-256 严格校验，不强制覆盖。
- 兼容流程先将换行符标准化（LF/CRLF）进行比较或合并，最后按本地文件原本的换行与 UTF-8 BOM 风格写入；仅本地格式变化时也不会整份拒绝。
- 三方合并对比：`baseline/`（原始 ZIP）+ 本地现有文件 + Stage 15 修改版。**出现冲突即停止**，不会将冲突标记写进项目。合并仅处理文本，不保证所有语义冲突都能自动判断，因此安装后必须跑业务测试。
- 使用 `git merge-file` 完全离线，不会访问 GitHub，和 Git HTTPS 握手错误无关；如果电脑没有 Git，实际有语义修改的文件无法合并，安装器会停下提示。
- `-DryRun` 在系统临时目录内生成候选合并结果，不改项目。正式安装前再次校验全部文件哈希，并将每个将修改的本地文件备份到 `_patch_backups/`；写入失败时尝试回滚。
- 禁止使用 `-Force` 或改写 manifest 哈希绕过冲突。若提示 `THREE-WAY CONFLICT`，应提供真实本地文件做针对性适配。
