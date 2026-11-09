# Stage 24C — AI 复盘价格说明回归修复

## 问题

使用上传的 Stage 24B 源码执行 `npm.cmd run test:ui` 时，85 项检查中有 2 项失败：

- `AI 报告页提供参考答案、费用链接和完整导出`
- `调用费用用示例假设而非虚构固定单价`

错误来自 `frontend/tests/ai-review-group8.test.mjs` 对 `InterviewReportPage.tsx` 的断言。第八组原已实现的价格说明和官方链接在后续更新中被覆盖；相关测试仍保留。并非 `npm ci`、BGE 下载、DeepSeek 认证或模型响应错误。

## 修复

在 `frontend/src/pages/InterviewReportPage.tsx` 的「可选 AI 深度复盘」设置区域恢复：

1. 官方价格文档链接 `https://api-docs.deepseek.com/zh-cn/quick_start/pricing`（新窗口安全打开）。
2. 输入 3000、输出 2000 Token 的**用量示例**，明确不是固定价格，也不宣称一次调用一定多少钱。
3. 已缓存复盘不重复调用模型、重新生成会再次计费的说明。

不修改后端、数据库、API Key、环境变量、已有 AI 结果或其他前端业务代码。

## 安装

解压本补丁，然后执行 `install-ai-pricing.ps1 -ProjectRoot <你的项目根目录> -DryRun`；检查通过后去掉 `-DryRun` 正式安装。安装器只对复盘页的一个已知位置做局部替换，保留其他本地修改。安装前备份，失败时回滚。补丁包含新增回归测试。

## 验证

在 `frontend` 目录运行：

```powershell
npm.cmd run test:ui
npm.cmd run build
```

可打开已结束答辩的复盘页，检查 AI 复盘区域是否显示缓存、费用说明和官方价格链接。这个修复本身不请求 DeepSeek，不产生模型费用。

## 限制

此补丁只针对上传源码与本次日志中两项测试缺失；若本地文件对应区域已大幅改动，安装器会安全停止而不是强制覆盖。以后修改复盘页时应保留官方费用说明并运行全部前端检查。
