# 第三组实施记录：简历和资料原文预览

- 日期：2026-10-27
- 对应优化方案：第 6 项和第 9 项
- 基线：第一组 UI 优化 + 第二组简历纠错 Stage 15；本包为增量安装
- 本轮不增加模型调用，不重建数据库，不迁移历史用户数据

## 交付范围

1. **第 6 项**：简历列表增加「预览原文」按钮；PDF 内嵌打开，DOCX 从已保存原文件提取文字。与第二组人工修订界面独立：预览不会使用或者覆盖 `structured_data`，避免把修订后的内容误称为原文。
2. **第 9 项**：「我的材料」列表加入相同操作，共用 `DocumentPreview` 弹窗及 API 格式处理。独立的材料、简历预览接口都通过既有账号认证与资源所有权校验。
3. **PPTX 兼容性**：按照 Stage 13 现有机制，PPTX 上传后仅保留 DOCX 文字提取版用于索引，故预览的是派生 DOCX 的文字。明确告诉用户不是原始幻灯片；不暗中新增对 PPTX 图表/图片的解析，也不声称已备份原 PPTX。
4. **开发痕迹**：第三组新代码使用用户能理解的按钮和状态文案，不向页面添加 Stage 版本号或临时测试提示；仍保留原有历史兼容标识，不在本组进行风险较大的内部重命名。

## 接口与文件

- `backend/app/services/document_preview.py`：统一的安全文件读取、PDF 流响应 / DOCX 文本响应。路径源自已查到的 SQLite 记录、当前账号上传目录；拒绝越界、软链接、格式异常、尺寸异常。
- `backend/app/api/resumes.py`：`GET /api/resumes/{resume_id}/preview`。
- `backend/app/api/materials.py`：`GET /api/materials/{material_id}/preview`。
- `frontend/src/lib/api.ts`：带状态码处理的二进制 / 纯文本预览请求。
- `frontend/src/components/DocumentPreview.tsx`：共用窗口、加载和错误状态、Esc 关闭、请求取消、PDF Blob URL 清理。
- `frontend/src/pages/ResumesPage.tsx`、`frontend/src/pages/MaterialsPage.tsx`：列表入口。
- `backend/tests/test_document_preview_group3.py`：临时 SQLite、临时文件夹、PDF 原件字节和响应头、DOCX、PPTX 派生文本、404、路径校验、损坏文件、归属中间件拦截。
- `frontend/tests/document-preview.test.mjs`：新增组件与 API 契约检查。

## 测试与验收

开发环境已执行：

```text
cd backend && PYTHONPATH=. pytest -q tests/test_document_preview_group3.py tests/test_resume_corrections_group2.py
10 passed
cd frontend && node --test tests/*.test.mjs
18 passed
```

开发环境的 `npm run build` 因此前端依赖不完整（缺失 `vite/client` 和 `@types/node`）未通过**环境检查**；未将其记为通过。需要在安装目标 Windows 机器使用 `npm.cmd ci` 后运行 `npm.cmd run build`。用户的 Stage 13 登录中间件应以真实账号在页面做一次手动验收。

手动验收顺序：

1. 登录账号，先备份 `storage/`（本包不会主动修改其中任何内容）。
2. 简历页：预览 PDF / DOCX，核对正文；关闭后重新打开；第二组「查看与修正」仍可用且内容未变。
3. 我的材料页：预览 PDF、DOCX，确认图片或复杂格式不会被误作已提取。
4. 上传小型 PPTX，检查列表保存的是文字提取版 DOCX；预览时有明确限制说明。
5. 删除资料后重新请求对应预览链接应得到 404；登出后请求预览应由登录中间件拒绝。不同账号不能读取对方的记录。
6. 检查上传、索引、查找、创建答辩仍然正常。

## 安装与兼容原则

本包提供 `install-group3.ps1 -DryRun` 和正式安装两个阶段；先检验清单和 payload 的 SHA-256，预检阶段不修改项目文件。对发生本地修改的既有源文件使用文本标准化及**离线**三方合并；合并发生冲突时中止，而不是整文件强制覆盖。所有实际要改的旧文件先备份到项目 `_patch_backups/group3_preview_时间戳`，写入出错则回滚。新文件仅在原路径不存在时创建。

与 GitHub 的在线连接无关，不会联网 `git pull` 或 `git clone`；本地 Git 仅在文件有非换行差异、需要三方合并时使用 `git merge-file`。如果原项目曾做过更改，请保留 `DryRun` 输出供排查。每次部署后运行后端测试和前端测试/构建。

## 本轮明确不做

- 原样保存或显示 PPTX 幻灯片的复杂布局/图片/截图；无 OCR。
- PDF 注释、编辑、缩略图、下载批量打包。
- 第 3/17/19/20 项大模型相关功能；第 18 项的智能薄弱点再练。
- 修改历史数据库结构、清理或迁移运行目录 `storage/`。
