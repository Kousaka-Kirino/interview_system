# Stage 12 — 保守代码整理（不修改功能）

本补丁严格依据用户上传的 `interview_system-main.zip` 制作，**不是**一次性的全面架构重构。尽量避免对 Stage 8/10/11 路由、登录、安全隔离、PPTX 上传、Embedding 与资料索引引入风险。

## 变更范围

| 路径 | 变更 |
| --- | --- |
| `backend/app/main.py` | 统一空行、缩进、导入语句布局，保持 Python AST 完全一致；所有注册顺序不变 |
| `backend/app/stage11_local.py` | 统一导入和字典排版，保持 Python AST 完全一致 |
| `frontend/src/App.tsx` | 格式整理，不改组件或页面逻辑 |
| `frontend/src/lib/api.ts` | 拆分长的 PPTX 上传调用行，上传 API 地址保持 `/api/pptx-import` |
| `.gitignore` | 忽略 `storage/users/` 下所有用户数据、SQLite 及两种历史备份文件 |
| `.editorconfig` | 新增编辑器格式规范 |
| 两个历史备份文件 | 若存在，将其移至本次安装备份目录的 `archived/`，不永久删除 |

**不做**：变更业务条件、注册/登录、数据库表结构、用户数据隔离、模型调用参数、PPTX 上传流程、CSS 或组件交互。所有个人 `storage/` 文件、`.env`、Chroma 索引原封不动。

## 使用要求

- Windows PowerShell；项目仍位于本机安装目录。
- 已有 Python 虚拟环境 `.venvs/interview_system`。
- 前端 `node_modules` 存在，并能执行 `npm.cmd run build`。
- 先停止 FastAPI 和 Vite（两个终端均按 `Ctrl+C`）。
- 安装器检查六个目标文件的原始 SHA-256：只接受当前上传 ZIP 同版本的文件或上次清理后文件。**检测到源码差异将拒绝覆盖**。容忍 Windows CRLF/LF 换行差异。

下载 `stage12_code_cleanup.zip`，解压至项目下的 `stage12_import` 文件夹，执行：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
$zip = Join-Path $HOME 'Downloads\stage12_code_cleanup.zip'
$unpack = Join-Path $project 'stage12_import'

if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { throw "找不到：$zip" }
New-Item -ItemType Directory -Path $unpack -Force | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 先预览：不改任何文件
& (Join-Path $unpack 'install-stage12.ps1') -ProjectRoot $project -DryRun

# 预览无误后再安装
& (Join-Path $unpack 'install-stage12.ps1') -ProjectRoot $project
```

如果提示 `frontend/node_modules missing`，先到前端目录执行 `npm.cmd ci`，再重试安装。

## 自动检查和回滚

安装器会执行：
1. 路径存在性和源码哈希校验；
2. Python 语法检查和目标文件 AST 相等性检查；
3. 核对 PPTX 上传地址、认证调用和用户数据目录仍存在；
4. 在项目**同级目录**建立时间戳备份，备份要改动的六个文件和已有的 `frontend/dist`（如果存在）；
5. 安装格式补丁；
6. `npm.cmd run build` 前端生产构建；
7. 检查成功后，将两个历史备份文件移至备份目录归档。

验证失败时自动回滚改动及原先的 `frontend/dist`。正常完成输出 `[Stage 12] SUCCESS.`。**保留备份目录直到手动确认注册、登录、PPTX 上传、知识库查询与答辩功能正常。**

安装器不负责删除或重建账号数据库；绝不直接删除 `storage/users/`。

## 重要：GitHub 仓库已有的用户数据库

上传的 ZIP **已经包含**一份 `storage/users/<UUID>/interview.db`。此补丁会更新 `.gitignore` 阻止未来未跟踪的用户数据库被添加，但 **`.gitignore` 无法让已经提交过的文件停止被 Git 跟踪，也无法清除 GitHub 历史版本**。

确认数据库已单独备份后，在 Git Bash / PowerShell 的仓库根目录执行下面的命令，可以让 Git 停止跟踪 `storage/users/`，同时保留电脑上的真实数据：

```powershell
git rm --cached -r --ignore-unmatch storage/users
git status --short
# 确认只有希望移出版本控制的数据及 Stage 12 源码变更后：
# git add .gitignore
# git commit -m "chore: keep local user storage out of source control"
```

如果 GitHub 仓库公开，既往提交中的数据库仍可能被其他人获取；有敏感信息的话，应当另外处理历史记录并检查是否需要更换泄露的凭据。**不要直接执行 `git rm -r storage/users`，那可能删除本机的真实用户资料。**

## 验证建议

```powershell
# 后端（已启动的虚拟环境）
cd C:\Users\Kirino\Desktop\interview_system\backend
python -m pytest -q

# 前端
cd ..\frontend
npm.cmd run build
```

然后手动检查：注册/登录，切换账号后的简历/PPT 隔离，PPTX 上传及 RAG 索引，发起和结束答辩、查看报告与语音模块。

**范围限制**：本版本以最小风格整理为主，暂不提取业务函数或调整目录结构，因为缺少完整 Windows 运行环境的端到端测试保障。
