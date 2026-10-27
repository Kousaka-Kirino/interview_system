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
