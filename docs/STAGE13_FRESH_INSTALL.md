# Stage 13：Windows 全新电脑首次建库 / 本地注册修复

> 对应本项目 2026-10-22 提供的完整源码。此补丁不创建默认用户名/密码，不迁移已有个人业务数据，也不公开数据库。

## 1. 修复了什么

本项目原有 `backend/app/core/database.py -> init_db()` 只建 SQLAlchemy 业务表。`backend/app/stage8b_auth.py` 在注册时会直接打开 `storage/data/interview.db` 并使用 `app_users`、`app_auth_sessions`、`app_auth_attempts`、`app_user_profiles`；在纯净机器上这些表并不会随业务表一起初始化。与此同时，`stage11_local.is_legacy_owner()` 假定一定存在 `aslan`，使全新安装中的普通首个账号无法使用独立工作区。

Stage 13 在 FastAPI lifespan 启动阶段，**先安全初始化认证数据库，再创建业务表**，并修正无 `aslan` 时代码的判断：

1. 新机器上自动创建 `storage/data/interview.db` 与四张认证表、两条会话索引；业务表仍由原 `init_db()` 创建。
2. **不生成 `aslan`、不生成默认账号/密码**。同学通过网页登录页自行注册第一个本地账号；新账号使用自己的 `storage/users/<UUID>/` 业务库、上传目录与 Chroma。
3. 已完成 Stage 8A/8B/8C2 的原账户数据库维持原样，旧 `aslan` 的简历、历史答辩及 Chroma 不会被转交新账号。
4. 检测到已有旧业务数据但没有账户归属记录时，明确报错并拒绝自动认领。此时应根据既有旧版迁移文档人工审核，**不能把别人的数据库复制给同学**。
5. 发现旧账户表缺字段、`aslan` 所有权元信息缺失、孤儿会话或 SQLite 完整性异常时，拒绝不安全的自动升级。
6. 已有数据库若确实需要补全认证空表，会先通过 SQLite online backup 保存一致性快照到 `storage/backups/stage13_auth_before_*.sqlite3`。

## 2. 代码位置

- `backend/app/stage13_bootstrap.py`：新建库表、结构验证、备份与 fail-closed 审计。
- `backend/app/main.py`：在 `init_db()` 之前调用 `initialize_account_database()`。
- `backend/app/stage11_local.py`：允许不存在旧 `aslan` 的新安装；仅已存在的 `aslan` 继续使用原工作区。
- `backend/tests/test_stage13_bootstrap.py`：新数据库、重复启动、异常旧库、原用户保护、两个本地账号实际注册与数据隔离测试。

不修改前端、PPTX 上传路由、已有密码哈希、用户资料或索引模型。

## 3. Windows 安装

安装前 **停止 FastAPI 与 Vite**，确认从 GitHub 获取的源码版本与本次上传的源码相同。下载 `stage13_first_run_db_fix.zip`，解压到项目外或临时目录，执行 ZIP 内 `install-stage13.ps1 -ProjectRoot <项目根目录>`。安装器提供 `-DryRun`：预览、不修改文件。

安装前安装器会执行：精确源码哈希检查、账号数据库只读结构审计、备份原始源码、对存在的账号数据库使用 SQLite `.backup()` 保存一致性快照（备份位于项目父目录），安装源文件，然后执行 **9 项 Python pytest 检查**。失败自动恢复安装器修改的源码。安装期间不会执行真实数据库迁移，也不会删除现有数据库。

> **注意：** 安装器的数据库备份只用于手工灾难恢复。正式安装后的数据库初始化发生在下次后端启动时。注册新账号后**不要**随意用安装前快照覆盖当前账户库，否则可能丢失新账号及会话信息。

## 4. 全新安装使用

1. 安装 Python 3.12 和项目依赖：`python -m pip install -r backend/requirements.txt`（先激活虚拟环境）。
2. 在项目根目录设置 `.env`，保持 `SQLITE_PATH=storage/data/interview.db` 或另一个位于项目 `storage/` 内的相对路径。
3. **不需要自行创建 `interview.db` 或运行 Stage 8A/8B 迁移脚本。**
4. 进入 `backend`，以项目虚拟环境运行：`python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`。
5. 出现 `[Stage 13] Local authentication tables ready. No default account created.` 与 `Application startup complete.` 表示初始化成功。
6. 另开终端执行前端 `npm.cmd run dev`，打开 `http://127.0.0.1:5173/`，在登录页点击「在本机注册」。用户名 3～32 位字母、数字或下划线（不能是保留的 `aslan`），密码至少 12 位。
7. 注册后可上传简历、PPTX 资料、建立索引与模拟答辩；同一电脑的另一新账号只能访问自己的空间。

本项目的 `/api/health` 也受现有登录中间件保护；未登录时返回 401 不代表建库失败。请以 FastAPI 启动日志和注册 HTTP 201 为准。

## 5. 注意和排错

| 现象 | 排查 |
|---|---|
| `Stage 13: Local authentication tables ready` 后注册 409 | 用户名重复；换一个用户名 |
| 注册 422 | 用户名或密码不满足要求 |
| 注册 503 | 核对 FastAPI 终端 traceback 与数据库目录写权限；确保真实用户不是打开了旧进程 |
| 启动提示 `Found existing rows ... without app_users` | 现有 SQLite 含旧业务数据、缺账户归属；请备份后按历史迁移流程人工核对，不能强制重建 |
| 启动提示 `Legacy account 'aslan' ... ownership metadata` | 旧库未完成 Stage 8C2；需要审核旧迁移，不要覆盖原数据 |
| 启动提示 `Auth/SQLAlchemy SQLITE_PATH disagreement` | 环境变量与 `.env` 配置不一致，核对 `SQLITE_PATH` |
| `WinError 10060` 下载 BGE 模型失败 | 与建库无关；保留已下载缓存，设置 `HF_HUB_OFFLINE=1` 与 `TRANSFORMERS_OFFLINE=1` |
| `/api/pptx-import` 405 | GET 打开上传地址会返回 405，真正上传使用 POST |

**安全提示：** 此系统只允许本机访问，不提供公网注册服务。勿将 `storage/data/`、`storage/users/`、`storage/backups/`、`.env` 提交到公开仓库。当前上传的旧 ZIP 含 `storage/users/.../interview.db`，即便 `.gitignore` 已增加忽略项，也需要确认 Git 历史和已跟踪文件中是否残留真实用户数据。
