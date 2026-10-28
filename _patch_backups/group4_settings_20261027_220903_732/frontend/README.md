# AI 答辩训练系统 · 前端

本目录使用 React、TypeScript 和 Vite，通过 `/api` 访问本机 FastAPI 后端。

## 开发与验证

在项目根目录以 PowerShell 进入 `frontend`：

```powershell
npm.cmd ci
npm.cmd run test:ui
npm.cmd run build
npm.cmd run dev
```

开发页面默认位于 <http://127.0.0.1:5173/>，后端默认在 `127.0.0.1:8000`；需另行启动后端。

## 页面入口

- `#dashboard`：数据概览与历史记录
- `#resumes`：简历管理
- `#materials`：我的材料（PDF / DOCX / PPTX、检索工具）
- `#configure`：创建模拟答辩
- `#session/<会话ID>`：答题会话
- `#report/<会话ID>`：答辩复盘

检索工具位于“我的材料”下方，默认折叠。用户无需手动执行检索即可开始正常答辩。

每次修改 UI 需要更新项目文档、补充相关测试，并执行 `npm.cmd run test:ui` 与 `npm.cmd run build`。本轮变更细节见 `../docs/UI_POLISH_PHASE1.md`。

## 简历解析与人工纠正（第二组）

- `#resumes`：上传后查看七个中文章节，支持编辑姓名/邮箱/电话及章节内容，点击“保存简历修正”写入当前账户的业务数据库。
- `#resumes/<简历ID>`：打开指定简历的编辑区域（仍然要求登录当前账户）。
- `#configure`：显示选中简历的章节填写完整度；缺少核心章节时可跳转“去补全”，不强制阻断练习。
- 健康度 `x/7` **仅表示章节有无内容，不是智能识别准确率**。原始提取文字和上传的文件不被手动纠正覆盖。
- 保存人工纠正后，新建答辩的提问/评分/追问会在上下文开头优先加入这些修正内容；无需新增模型调用。

API 契约和验证命令见 `../docs/UI_POLISH_PHASE2.md`。

## 第三组：原文预览（第 6、9 项）

- 「简历管理」与「我的材料」的每条记录都有「预览原文」按钮。
- PDF：在弹窗内使用浏览器 PDF 查看器；DOCX：显示即时读取原文件并抽取的纯文字，不保留 Word 版式。
- 从 PPTX 上传的材料在列表内实际显示 `_PPTX文字提取版.docx`，只能预览提取出的文字，不能还原原始 PPT 图片与排版。
- 与第二组的「查看与修正」不同，原文预览是**只读**，不覆盖用户已经修正的结构化简历数据。
- 需要正常启动 FastAPI、通过登录才能读取；关闭预览会终止未完成的请求并释放浏览器内的 PDF 临时地址。
- 新增自动化测试：`cd backend; python -m pytest -q tests/test_document_preview_group3.py` 与 `cd frontend; npm.cmd run test:ui`，另运行 `npm.cmd run build` 验证 TypeScript 和 Vite。
- 完整改动与限制参见 `docs/UI_POLISH_PHASE3.md`。
