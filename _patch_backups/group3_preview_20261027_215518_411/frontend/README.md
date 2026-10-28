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
