# Stage 24A — PPT 不能翻页修复（2026-10-28）

## 根因与修复

1. Stage 24 页码输入框每输入一个字符便直接 clamp，因此无法可靠跳到 12、100 等多位页码。现在改成草稿输入，Enter / 失焦后才校验与跳转。
2. Stage 24 误把 Windows 上“有 PowerShell”视为“有 PowerPoint”。即使没有 Office，也会发起耗时的本机 PDF 渲染。现在必须有 LibreOffice 或注册的 PowerPoint COM 类才启用图像渲染；否则直接走无网络的文字翻页。
3. 旧 PPTX 衍生 DOCX 的某些标题格式（例如“第 2 页：说明”）无法被旧正则识别。现在兼容此类标题。
4. 翻页区显示明确的页数与只有一页时的原因提醒，并新增左右方向键、PageUp/PageDown、Home/End；页码输入不会干扰全局答题。

**注意**：若后端确实只识别到 1 页，前端无法凭空生成不存在的页面。此时需检查该文件本身并重新导出、上传。原始 PPTX 只为 Stage 24 后上传的材料保存；更早的文字提取版不可能恢复丢失的图片/版式。

## 变更文件

- `frontend/src/components/presentation/SlideDeck.tsx`：翻页控制、状态、提示和键盘支持。
- `frontend/src/lib/presentation.ts`：页码输入与步进函数。
- `backend/app/services/presentation_local.py`：Windows 本地渲染识别和旧版文字页标题兼容。
- `backend/tests/test_group11_local_presentation.py`：真实三页 PPTX/PNG 各页内容/旧 DOCX 页码/渲染判定。
- `frontend/tests/group11-presentation.test.mjs`：多位页码输入及翻页测试。
- `frontend/README.md` 与本文：使用和验收说明。

## 安装保护

只安装 Stage 24A 增量文件；先 `-DryRun` 再正式运行。脚本核验 SHA-256、仅对非冲突编辑使用离线 Git 三方合并，备份原代码并在写入失败时回滚。不删除用户 storage 目录、不更改账号数据库、不读取 `.env` 或 API Key。无需连接 GitHub。

## 验收步骤

1. 使用含 3 页以上的 PPTX。登录后打开“我的材料”→“本地幻灯片展示”，应显示“当前第 1 页，共 N 页”。
2. 按“下一页”可看到第 2 页；按“上一页”可返回第 1 页。点击展示区后按 ← → 或 PageUp/PageDown。
3. 输入 `12`（若文件有至少 12 页）并按 Enter，应直接跳到 12；输入空白不会改变当前页。
4. 打开项目答辩模式并选择该材料，再测试翻页，不应触发模型计费。
5. 若提示只有 1 页，核对本地文件和重新上传一份 PPTX。若有原文件但无法渲染图片，请安装 PowerPoint 或 LibreOffice；文字模式仍应翻页。

后端：`python -m pytest -q tests/test_group11_local_presentation.py`。
前端：`npm.cmd run test:ui`、`npm.cmd run build`。
