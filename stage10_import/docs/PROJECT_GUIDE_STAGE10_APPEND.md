<!-- STAGE10_PPTX_BEGIN -->
## Stage 10 — PPTX 补充资料上传与 RAG 检索

- 本阶段新增 PPTX 文字提取兼容入口，不修改既有 SQLite 表和 Chroma 集合结构。
- 前端资料管理允许选择 `.pptx`；PDF/DOCX 上传路径保持原样。
- 新增 `POST /api/materials/pptx-import`，仅限已登录用户；服务端限制 12 MiB、150 页、200,000 字符，并拒绝异常 ZIP 文件结构。
- 服务端按演示文稿定义的页面顺序提取可选择文字，为每页写入“第 N 页”标签，再生成 DOCX 文字提取副本，转入现有 `/api/materials` 上传、文本切片、嵌入及 Chroma 索引流程。
- **重要：这是第一版 PPTX 文字兼容导入**。知识库储存的是 `原名_PPTX文字提取版.docx`，不是原始 PPTX；图片、扫描截图、图表、公式、视频和动画不在本版 OCR 范围。旧 `.ppt` 请先在 PowerPoint 或 LibreOffice 中另存为 `.pptx`。
- 原始 PDF/DOCX 资料与原有用户、登录及知识库过滤逻辑保持不变；PPTX 导入使用既有受认证保护的 DOCX 上传流程，不绕过所有权校验。
- 如原 PPTX 有重要示意图，建议额外准备文字讲稿或导出有可选择文本的 PDF。
- 测试：运行 `python tests/test_stage10_pptx.py backend`（在本阶段安装包根目录，使用项目 venv 解释器）；前端在 `frontend/` 执行 `npm.cmd run build`。
- 安装要求：先停止 FastAPI；脚本会自动备份全部改动源码与两份 Markdown 文档；失败尝试回滚。不会修改 `.env`、原有数据库、向量库、用户资料或 Ollama。
<!-- STAGE10_PPTX_END -->
