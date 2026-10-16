# PROJECT_GUIDE.md — 基于简历与 RAG 的 AI 模拟面试系统工程手册

> **版本**：V1.4（2026-10-15，Stage 1B：简历上传与 SQLite 存储）  
> **使用方式**：将本文件固定放在 `C:\Users\Kirino\Desktop\interview_system\PROJECT_GUIDE.md`。以后每完成一个阶段，往本文末尾的**开发日志**追加记录；改架构时先记下设计决策。**所有接口另外记录在根目录 `API_DOCUMENTATION.md`，每次改后端接口必须同步更新。**  
> **当前进度**：用户已确认依赖安装和前一阶段的测试通过；**Stage 1A** 的面试配置与自适应规则保留。本轮实现 **Stage 1B（简历 PDF/DOCX 上传、离线文本解析、结构化摘要、SQLite 存储、查询和删除）**。**尚未实现资料 RAG、DeepSeek 正式面试会话和评分持久化。**  
> **操作环境**：Windows 10/11，PowerShell；用户本机已经安装并使用 **Python 3.12.9（64 位）**，虚拟环境为 `.venvs\interview_system`。本轮无需重建虚拟环境。命令在 **PowerShell** 执行。

## 0. 架构决定（本轮已变更）

**严格不使用 Docker，不需要安装 PostgreSQL 或配置系统数据库服务。** 考虑到第一版是 Windows 本机开发/单用户 MVP，采用两类文件式数据存储：

| 数据类型 | 技术 | 保存位置 | 是否需要独立启动 |
|---|---|---|---|
| 简历原文件、简历结构化内容、资料元数据、面试会话、复盘报告 | **SQLite + SQLAlchemy** | `storage/data/interview.db` | 否 |
| 补充资料分块、向量、分块元数据 | **ChromaDB PersistentClient** | `storage/chroma/` | 否 |
| 用户上传的简历与补充资料 | 本地文件系统 | `storage/uploads/` | 否 |
| 面试提问、追问、评分与复盘 | **DeepSeek API** | 外部模型 API | 需要网络和 API Key |
| 补充资料中文向量化 | `sentence-transformers`，`BAAI/bge-small-zh-v1.5` | 首次下载模型权重后在本机运行 | 否（会占用磁盘/内存） |

**为什么不把简历放进向量库？** 简历通常较短，先解析全文并结构化为 JSON 存在 SQLite，直接加入面试上下文即可；面试问题以简历中的技能、项目、实习为主线。**补充资料**可能较长，采用 ChromaDB 建索引后检索有出处的片段，作为深追问依据。资料没有上传或检索不到时，LLM 仍可只依据简历和已发生的问答进行面试。

**通信**：React/Vite → HTTP `/api/*` → FastAPI → DeepSeek；没有多智能体、LangGraph、消息队列、语音识别或实时心理感知。先做 REST API，不先实现 WebSocket。

```text
浏览器 React + TypeScript + Tailwind (localhost:5173)
                | /api/* Vite proxy
                v
        FastAPI (127.0.0.1:8000)
           |         |                |
           |         |                +--> DeepSeek API: 生成提问/追问/复盘
           |         |
           |         +--> ChromaDB: 检索资料切片 (本机文件库)
           |                ^
           |                | 中文 Embedding 本机计算，Stage 2 接入
           |
           +--> SQLite: 简历/资料元数据/会话/问答/报告
                    + 本地 storage/uploads 原始文件
```

**隐私边界**：真实简历、面试回答和选中的补充资料片段在调用 DeepSeek 时**会发送给第三方 API**；即使 SQLite、ChromaDB 和向量化都在本地，这一点也不会改变。先用脱敏材料测试。`.env` 和 `storage/` 私有内容不提交 Git，不把 API Key 写进 React 源码。第一版只适合本机开发使用，公网/多用户上线前必须增加权限和文件访问隔离。

**为何变更？** V1.1 的 PostgreSQL + pgvector（Docker）需要容器或额外 Windows 数据库安装、扩展配置；本轮优先“易部署”。将来有并发、多用户、远程服务等需求时再评估迁移回 PostgreSQL + pgvector，**不是**第一版必须项。

## 1. 首次安装前：检查 Windows 开发工具

每一行可单独执行。**已安装的软件跳过安装**。

```powershell
winget --version
python --version
node --version
npm.cmd --version
git --version
code --version
```

现有环境使用 **Python 3.12.9 64 位**；Node.js 使用较新的 LTS，Vite 官方文档当前基本要求 Node >= 20.19 或 >= 22.12（如安装时出现更高要求，按提示升级）。`code --version` 只有在 VS Code 命令行入口配置好时才有效，不影响开发。

如果缺少软件，用 Windows PowerShell 逐条安装：

```powershell
winget install -e --id Python.Python.3.12
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Git.Git
winget install -e --id Microsoft.VisualStudioCode
```

这些并非要全部重复安装；已装的软件不必再次执行。**没有 Docker 安装命令，不需要 WSL2，不需要 PostgreSQL 安装包。**

安装完成后**关闭 PowerShell，重新打开**再验证：

```powershell
python --version
node --version
npm.cmd --version
git --version
```

如提示 `py` 不存在，直接使用已安装的 `python` 命令；`winget` 不存在时使用软件官网 Windows 安装器。

## 2. 创建项目目录并放置 Stage 0 骨架

本次提供：`PROJECT_GUIDE.md` 和 `interview_system_stage0_local.zip`。**建议先备份你此前工程里的 `.env` 和任何已写好的文件，避免 ZIP 解压覆盖旧代码。** 如果你的工程已经有 Docker/PostgreSQL 版本，请看第 2.3 小节。

### 2.1 全新工程（推荐）

打开 PowerShell：

```powershell
New-Item -ItemType Directory -Force -Path 'C:\Users\Kirino\Desktop\interview_system'
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
# 如果 ZIP 下载到了 Windows 默认“下载”目录
Expand-Archive -LiteralPath "$HOME\Downloads\interview_system_stage0_local.zip" -DestinationPath .
Get-ChildItem -Force
```

`Expand-Archive` 默认不覆盖已存在文件。如果你之前解压过旧版本，别直接用 `-Force` 粗暴覆盖；先看 2.3。下载路径不是 `Downloads` 时，将 ZIP 路径替换成实际位置。把新的 `PROJECT_GUIDE.md` 覆盖旧指南前，先备份旧版开发日志。

如果当前目录还不是 Git 仓库，推荐初始化版本控制（Git 并非后端运行所必需）：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
git init
```

`.gitignore` 已排除 `.env`、虚拟环境以及 `storage/data`、`storage/chroma`、`storage/uploads` 中的私有数据。

### 2.2 预期项目目录（Stage 0）

```text
C:\Users\Kirino\Desktop\interview_system\
├── PROJECT_GUIDE.md
├── .env.example                     # 环境配置模板，无密钥
├── .env                             # 手动创建，含 DeepSeek Key
├── .gitignore
├── .venvs\interview_system\         # Python 虚拟环境（执行 venv 后生成）
├── backend\
│   ├── requirements.txt
│   ├── app\
│   │   ├── __init__.py
│   │   ├── main.py
│   │   └── core\
│   │       ├── __init__.py
│   │       └── config.py
│   ├── scripts\
│   │   ├── test_deepseek.py
│   │   ├── test_sqlite.py
│   │   └── test_chroma.py
│   ├── pytest.ini                 # 只收集 tests/ 下的单元测试
│   └── tests\test_health.py
├── frontend\                       # 第 5 节用 Vite 自动创建
└── storage\
    ├── uploads\                     # Stage 1 后开始保存文件
    ├── data\interview.db             # 运行本地 SQLite 脚本后自动生成
    └── chroma\                       # 运行 Chroma 脚本后自动生成
```

`storage` 内的数据库文件/向量索引都**不要手动创建空文件**；运行连通性测试会自动生成。项目所在磁盘最好预留几个 GB，因 PyTorch、模型权重等依赖可能较大。

### 2.3 如果你已经解压了先前的 Docker 版

1. **先备份**旧项目及 `.env`；如旧数据库中已有数据，不要删除或自动迁移，先另外安排迁移。
2. 新版本根目录中**不再需要** `docker-compose.yml`；确认它是旧骨架生成、无业务修改后再删除：

   ```powershell
   Set-Location 'C:\Users\Kirino\Desktop\interview_system'
   # 确认旧 compose 文件不是自己后来编辑的重要文件后才执行：
   Remove-Item .\docker-compose.yml
   ```

3. 用本次 ZIP 中的 `.env.example`、`.gitignore`、`backend/requirements.txt`、`backend/app/core/config.py`、`backend/scripts/test_sqlite.py`、`backend/scripts/test_chroma.py` 替换**旧 Stage 0 对应文件**；其它有业务逻辑的文件不要盲目覆盖。
4. 已有 `.env` 保留 `DEEPSEEK_API_KEY`/模型配置，删去旧 `DATABASE_URL=postgresql...` 行，加入 `SQLITE_PATH`、`CHROMA_PATH`、`UPLOAD_PATH`；参考本指南第 6 节。无需再启动旧 Docker 容器。 **旧 PostgreSQL 数据不会自动出现在 SQLite。**
5. 旧虚拟环境如果已经装了 pgvector、psycopg，不会直接妨碍启动；如果想彻底清理，请先确认环境里没有个人额外安装的包，再按第 3 节的“重建虚拟环境”操作。

## 3. 创建 Python 虚拟环境并安装后端所有依赖

**运行位置：项目根目录。虚拟环境名称：`interview_system`。**

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
python -m venv .\.venvs\interview_system
.\.venvs\interview_system\Scripts\Activate.ps1
python --version
python -m pip install --upgrade pip
python -m pip install -r .\backend\requirements.txt
python -m pip check
```

PowerShell 提示通常变为 `(interview_system)`。这份 requirements 已包括：FastAPI、Uvicorn、DeepSeek OpenAI SDK、SQLAlchemy、Alembic、ChromaDB、本地 Embedding、PDF/DOCX 读取和 pytest。**SQLite 是 Python 标准库自带的，不需单独 pip install sqlite 或安装 SQLite Server。**

`sentence-transformers` 会间接安装 PyTorch，下载量可能较大。首次加载中文 Embedding 模型（在 Stage 2，而非 Stage 0）还需要联网下载模型权重。这里先安装依赖，但不要把“依赖安装成功”误认为“中文向量模型已下载”。

如果 `Activate.ps1` 遇到执行策略错误，**仅当前终端**执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force
.\.venvs\interview_system\Scripts\Activate.ps1
```

或无需激活，直接用虚拟环境的 Python：

```powershell
& 'C:\Users\Kirino\Desktop\interview_system\.venvs\interview_system\Scripts\python.exe' -m pip install -r .\backend\requirements.txt
```

**虚拟环境只创建一次。** 今后开新终端，仅 `Set-Location` + `Activate.ps1`；离开虚拟环境输入 `deactivate`。`pip` 安装卡顿时先检查磁盘/网络，不要反复重新创建虚拟环境。

如果之前创建的 venv 不可用，并且确定其中没有需要保留的安装，可从项目根目录重建：

```powershell
# 确认没有正在使用此虚拟环境的进程之后再执行
# 若旧环境正处于激活状态，先 deactivate
Remove-Item -Recurse -Force .\.venvs\interview_system
python -m venv .\.venvs\interview_system
.\.venvs\interview_system\Scripts\Activate.ps1
python -m pip install -r .\backend\requirements.txt
```

## 4. 本机 SQLite 与 ChromaDB 初始化（无 Docker）

**先完成第 3 节依赖安装。** 下面两个脚本会自动创建本地目录和必要文件，不需要先创建表或启动服务。

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\backend'
python -m scripts.test_sqlite
python -m scripts.test_chroma
```

正常应出现“SQLite 本地数据库正常”“ChromaDB 本地向量库正常”。

- SQLite 文件：`C:\Users\Kirino\Desktop\interview_system\storage\data\interview.db`。
- ChromaDB 数据：`C:\Users\Kirino\Desktop\interview_system\storage\chroma\`。
- `test_chroma.py` 使用**手写的 3 维测试向量**验证创建、插入、查询、删除；不会下载 Embedding 模型，也**不代表真实 RAG 已完成**。后续真实资料的向量维度取决于 Stage 2 所选模型。
- SQLite 在 Stage 0 只做“能创建文件和连接”的检查，**业务表要等 Stage 1 开始设计与创建**。

**本地开发限制**：Chroma 持久化嵌入式客户端适合一个 FastAPI 进程使用，不要运行多个后端 worker 同时写同一个 `storage/chroma` 目录；Uvicorn 初期只用一个进程。

## 5. 创建 React 前端并安装依赖

返回项目根目录。前端由 Vite 自动生成，ZIP 中**没有** `frontend` 项目。

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
npm.cmd create vite@latest frontend -- --template react-ts
Set-Location .\frontend
npm.cmd install
npm.cmd install axios react-router-dom @tanstack/react-query lucide-react echarts echarts-for-react
npm.cmd install -D tailwindcss @tailwindcss/vite
npm.cmd run build
```

前端主要依赖用途：axios 请求 API、react-router-dom 路由、TanStack Query 维护服务端请求状态、lucide-react 图标、ECharts 能力报告图表、Tailwind 样式。现在先装好，不表示 Stage 0 要写全部页面。

如果创建脚手架时提示 `frontend` 文件夹已存在：说明你之前创建过，**跳过 `npm.cmd create vite...`**，在现有 `frontend` 目录安装依赖即可。某些 PowerShell 会拦截 `npm.ps1`，因此本指南统一使用 `npm.cmd`。

用 VS Code 修改第 9 节列出的前端文件后，再执行：

```powershell
npm.cmd run build
```

## 6. 配置 DeepSeek API（密钥仅在后端）

在项目根目录，第一次才执行：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
Copy-Item .env.example .env
code .
```

如已经有 `.env`，**不要直接覆盖**，自行按以下模板同步新增配置并保留真实 Key：

```dotenv
DEEPSEEK_API_KEY=请替换成你自己的真实Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
SQLITE_PATH=storage/data/interview.db
CHROMA_PATH=storage/chroma
UPLOAD_PATH=storage/uploads
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

DeepSeek 模型名称 `deepseek-flash` 与 `https://api.deepseek.com` 来自官方文档（2026-10 核对）；若官方后续更改，以控制台和模型列表为准。API Key 应在 DeepSeek 平台自行创建，**绝对不要**写进 `frontend/src` 或 `VITE_...` 变量。

测试真实 API（**会产生少量付费调用**）：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend
python -m scripts.test_deepseek
```

测试通过会打印中文返回；如果出现 401，检查 Key；402/余额不足检查账户；404 检查模型名及接口；429 稍后再试。**不要在截图或聊天中提供完整 API Key。**

## 7. 每次启动项目：只用两个 PowerShell 终端

本机不运行数据库服务。SQLite/ChromaDB 文件由后端自动读写；不需要开第三个窗口来运行它们。

### 终端 A：启动后端

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

浏览器访问：

- `http://127.0.0.1:8000/api/health`：应返回 `{"status":"ok","service":"interview-system-api"}`；
- `http://127.0.0.1:8000/docs`：FastAPI Swagger 接口文档。

注意：此健康接口只验证 API 进程，不验证 SQLite/ChromaDB/DeepSeek；它们分别通过 4、6 节测试。

### 终端 B：启动前端

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run dev
```

浏览器访问 `http://localhost:5173`，应显示“后端连接正常”（需先按第 9 节替换前端文件）。前端此时只是一个**连通性演示首页**。

### 终端 A 的测试指令（需先停止 Uvicorn 或另开终端）

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend
python -m pytest -q
```

### Stage 0 完成判定（在你电脑上运行后自己勾选）

- [ ] `python --version` 正常；`node --version`、`npm.cmd --version` 正常。
- [ ] `.venvs\interview_system` 已创建并激活。
- [ ] `python -m pip check` 没有依赖冲突。
- [ ] `python -m scripts.test_sqlite` 通过，本地 `.db` 已生成。
- [ ] `python -m scripts.test_chroma` 通过，本地向量目录可读写。
- [ ] `python -m scripts.test_deepseek` 返回中文内容（需要 Key/网络/余额）。
- [ ] `python -m pytest -q` 通过。
- [ ] `/api/health` 返回 `ok`，浏览器前端显示“后端连接正常”。

## 8. 如果不使用 ZIP，手工创建后端文件

先执行（从项目根目录）：

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
New-Item -ItemType Directory -Force backend\app\core,backend\scripts,backend\tests,storage\uploads,storage\data,storage\chroma
New-Item -ItemType File -Force backend\app\__init__.py,backend\app\core\__init__.py
```

接下来使用 VS Code 新建相对路径，粘贴本节给出的**完整内容**。如果使用 ZIP，请跳过本节这些手工步骤；**不要两种创建方式同时覆盖已有代码**。

### `.gitignore`

```gitignore
# Python
.venvs/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
# Frontend
frontend/node_modules/
frontend/dist/
# Private settings and local personal data
.env
.env.*
!.env.example
storage/data/
storage/chroma/
storage/uploads/
# OS / IDE
.vscode/
.idea/
Thumbs.db
.DS_Store
```

### `.env.example`

```dotenv
# 请复制为 .env，真实 API Key 不要提交到 Git
DEEPSEEK_API_KEY=replace_with_your_own_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
# 所有路径以项目根目录为基准，自动转换为绝对路径
SQLITE_PATH=storage/data/interview.db
CHROMA_PATH=storage/chroma
UPLOAD_PATH=storage/uploads
# Stage 2 才需要第一次下载本地模型权重
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### `backend/requirements.txt`

```text
# Backend API and configuration
fastapi>=0.115,<1
uvicorn[standard]>=0.30,<1
python-multipart>=0.0.9,<1
pydantic-settings>=2.5,<3
# DeepSeek OpenAI-compatible SDK
openai>=1.70,<3
# Local structured-data storage
sqlalchemy>=2.0,<3
alembic>=1.13,<2
# Local vector store and Chinese embedding (Stage 2)
chromadb>=1.0,<2
sentence-transformers>=3.0,<6
numpy>=1.26,<3
# Resume and material extraction
pymupdf>=1.24,<2
python-docx>=1.1,<2
# Testing and quality
httpx>=0.27,<1
pytest>=8,<10
ruff>=0.6,<1
```

### `backend/app/core/config.py`

```python
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py -> core -> app -> backend -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"
    sqlite_path: str = "storage/data/interview.db"
    chroma_path: str = "storage/chroma"
    upload_path: str = "storage/uploads"
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @staticmethod
    def _project_path(raw: str) -> Path:
        value = Path(raw)
        return value if value.is_absolute() else PROJECT_ROOT / value

    @property
    def sqlite_file(self) -> Path:
        return self._project_path(self.sqlite_path)

    @property
    def chroma_dir(self) -> Path:
        return self._project_path(self.chroma_path)

    @property
    def uploads_dir(self) -> Path:
        return self._project_path(self.upload_path)

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.sqlite_file.as_posix()}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

### `backend/app/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings

settings = get_settings()
app = FastAPI(title="Interview System API", version="0.1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in settings.cors_origins.split(",") if item.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "interview-system-api"}
```

### `backend/scripts/test_sqlite.py`

```python
import sqlite3

from app.core.config import get_settings


def main() -> None:
    db_file = get_settings().sqlite_file
    db_file.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_file) as conn:
        result = conn.execute("SELECT sqlite_version()").fetchone()
        assert result is not None
    print(f"SQLite 本地数据库正常：{db_file}")
    print(f"SQLite 版本：{result[0]}")


if __name__ == "__main__":
    main()
```

### `backend/scripts/test_chroma.py`

```python
import chromadb

from app.core.config import get_settings


def main() -> None:
    chroma_dir = get_settings().chroma_dir
    chroma_dir.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(chroma_dir))
    # 只测试存储与查询，不下载 Embedding 模型
    collection = client.get_or_create_collection(name="stage0_smoke")
    collection.upsert(
        ids=["test-1"],
        embeddings=[[0.1, 0.2, 0.3]],
        documents=["这是本地向量库连通性测试"],
    )
    result = collection.query(query_embeddings=[[0.1, 0.2, 0.3]], n_results=1)
    assert result["ids"][0][0] == "test-1"
    client.delete_collection(name="stage0_smoke")
    print(f"ChromaDB 本地向量库正常：{chroma_dir}")


if __name__ == "__main__":
    main()
```

### `backend/scripts/test_deepseek.py`

```python
from openai import OpenAI

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    if not settings.deepseek_api_key or settings.deepseek_api_key == "replace_with_your_own_key":
        raise SystemExit("请先在项目根目录的 .env 中设置 DEEPSEEK_API_KEY")

    client = OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        timeout=40.0,
        max_retries=1,
    )
    response = client.chat.completions.create(
        model=settings.deepseek_model,
        messages=[
            {"role": "system", "content": "你是简洁的 API 连接测试助手。"},
            {"role": "user", "content": "请用一句中文确认连接成功。"},
        ],
        max_tokens=80,
    )
    print("DeepSeek API 返回：")
    print(response.choices[0].message.content or "<空响应>")


if __name__ == "__main__":
    main()
```

### `backend/pytest.ini`

```python
[pytest]
testpaths = tests
```

### `backend/tests/test_health.py`

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "interview-system-api"}
```

## 9. 前端 3 个文件完整代码

前端脚手架生成后，修改/替换以下 3 个文件即可。**不要删 `src/main.tsx`、`index.html`、`tsconfig.json` 等脚手架配置。**

### `frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
```

### `frontend/src/index.css`

```css
@import "tailwindcss";

:root {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  min-width: 320px;
}
```

### `frontend/src/App.tsx`

```tsx
import { useEffect, useState } from 'react'

type Health = { status: string; service: string }

export default function App() {
  const [message, setMessage] = useState('正在连接后端…')

  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as Health
      })
      .then((data) => setMessage(data.status === 'ok' ? '后端连接正常' : '后端返回异常'))
      .catch(() => setMessage('无法连接后端：请先启动 FastAPI'))
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <section className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
        <h1 className="text-3xl font-bold">AI 模拟面试系统</h1>
        <p className="mt-3 text-slate-300">Stage 0：本机开发环境验证</p>
        <p className="mt-6 rounded-lg bg-slate-800 p-4">{message}</p>
        <p className="mt-4 text-sm text-slate-400">下一阶段：简历上传与结构化解析。</p>
      </section>
    </main>
  )
}
```

## 10. 数据与 API 规划（Stage 0 不创建业务表）

### SQLite 业务表（Stage 1~4 再使用 SQLAlchemy/Alembic 落地）

| 表名 | 关键字段 | 说明 |
|---|---|---|
| `resumes` | `id, filename, file_path, full_text, structured_json, created_at` | 简历全文和结构化 JSON 文本，不保存到 Chroma；可使用 SQLAlchemy JSON 类型，SQLite 底层仍以文本保存 |
| `materials` | `id, filename, file_path, status, created_at` | 补充资料文件元数据；上传一个文件建一条记录 |
| `interview_sessions` | `id, resume_id, status, settings_json, created_at, ended_at` | 一次面试，绑定简历与资料选择 |
| `interview_turns` | `id, session_id, turn_no, question, answer, source_chunk_ids_json` | 每轮问答及实际引用的资料块 ID |
| `interview_reports` | `id, session_id, scores_json, summary, suggestions_json` | 面试复盘和逐项评分 |

**ChromaDB collection 规划**：`material_chunks`，每个 chunk 具有 `id`、`document`、`embedding` 与 metadata（如 `material_id`、`chunk_index`、`source_name`、`page_number`）；删除资料时同时删除 Chroma 对应向量记录。`materials` 表与 Chroma 向量之间不会自动保持事务一致，Stage 2 需要实现“资料状态 + 清理失败重试”的一致性策略。

### REST API 规划

| 方法 | 地址 | 阶段 | 说明 |
|---|---|---|---|
| `GET` | `/api/health` | 0 ✅ | 基础健康检查 |
| `GET` | `/api/interviews/options` | 1A | 获取评委风格、难度/调节等级与默认配置 |
| `POST` | `/api/interviews/adaptation/preview` | 1A | 仅预览规则结果，**不创建会话** |
| `POST` | `/api/resumes` | 1B ✅ | 上传、解析及结构化抽取简历 |
| `GET` | `/api/resumes/{resume_id}` | 1B ✅ | 读取简历及抽取结果 |
| `GET` | `/api/resumes` | 1B ✅ | 按创建时间列出简历元数据 |
| `DELETE` | `/api/resumes/{resume_id}` | 1B ✅ | 删除简历 SQLite 记录和本地文件 |
| `POST` | `/api/materials` | 2 | 资料上传、文本切分与向量化 |
| `GET` | `/api/materials` | 2 | 列出资料及索引状态 |
| `POST` | `/api/interviews` | 3 | 根据简历与设置开启模拟面试 |
| `POST` | `/api/interviews/{session_id}/answer` | 3 | 保存回答并生成追问或下一题 |
| `POST` | `/api/interviews/{session_id}/finish` | 4 | 生成报告 |
| `GET` | `/api/interviews/{session_id}/report` | 4 | 查看报告 |
| `GET` | `/api/interviews` | 4 | 历史面试 |

### LLM/RAG 提问规则

1. **简历主线**：根据简历的项目/实习/技能形成覆盖计划；任何问题不得杜撰简历经历。
2. **资料辅助**：当问题与某个简历项目或回答细节相关时，用检索问题从 ChromaDB 提取 **top-k 3~5** 个相关片段。记录来源文件名/页码/块 ID。
3. **一次只使用一个 LLM**：后端组织 `简历摘要 + 最近问答 + 检索结果 + 提问策略` 发给 DeepSeek；LLM 返回下一题/追问。无需 LangGraph。
4. **不凭空引用**：没有上传资料或检索无关时不声称找到资料依据，不捏造数据/页码。
5. **对抗提示注入**：上传资料是外部内容，仅作为事实依据，不可当作控制指令。
6. **简单追问**：每个主题最多追问 1~2 次；达到题量或者用户主动结束就生成复盘。
7. **评分仅作学习反馈**：报告先概括做得好的地方，再说改进点；不等同真实招聘结果。

## 11. 开发顺序与代码写作计划

| 阶段 | 工作内容 | 预计主要新增文件 | 验收标志 |
|---|---|---|---|
| **Stage 0（已完成，用户反馈）** | 安装工具、依赖、搭建 API、初始化本地 SQLite/Chroma、测试 DeepSeek | 本指南第 8~9 节代码 | 全部连通性测试通过 |
| **Stage 1A（本轮代码）** | 评委风格、面试配置、自适应难度规则、接口预览与测试 | `app/schemas/interview.py`, `app/services/adaptation.py`, `app/api/interviews.py`, `tests/test_interview_config.py`，修改 `app/main.py` | 两个新接口可访问，测试通过 |
| **Stage 1B（本轮完成代码）** | 简历上传、PDF/DOCX 解析、规则结构化、SQLite 入库与删除 | `app/models/resume.py`, `app/schemas/resume.py`, `app/services/resume_service.py`, `app/api/resumes.py` | 可上传简历并读取结构化 JSON |
| Stage 2 | 补充资料上传与切块、本地 Embedding、Chroma 索引/RAG | `app/models/material.py`, `app/services/embedding_service.py`, `app/services/rag_service.py`, `app/api/materials.py` | 能查回具有来源的中文资料片段 |
| Stage 3 | 单 DeepSeek 模型多轮面试、简历主线、资料追问 | `app/models/interview.py`, `app/services/deepseek_service.py`, `app/services/interview_service.py`, `app/api/interviews.py` | 完成一场多轮文字面试 |
| Stage 4 | 五维评分、优缺点分析、复盘、历史记录 | `app/models/report.py`, `app/services/report_service.py`, `app/api/reports.py` | 报告可生成、可再次查看 |
| Stage 5 | 前端整体体验、失败重试、安全、备份与部署 | 前端各页面、tests、日志与清理任务 | 可供本机日常使用的 MVP |

**工程约定**：一个 FastAPI 进程 + SQLite + ChromaDB 文件库；新模块写独立服务类/函数，避免把上传、索引、提问都写到 `main.py`。RAG 及 LLM 调用统一在后端，React 不触碰 Key。每一阶段完成测试后再推进。

## 12. 日常命令与排错

每次重新开项目（Python venv 只需重新激活，不用重新 `venv`）：

```powershell
# A: 后端
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# B: 前端（另一个 PowerShell）
Set-Location 'C:\Users\Kirino\Desktop\interview_system\frontend'
npm.cmd run dev
```

- `python` 不存在：检查 Python 3.12 安装和 `py -0p`。
- `Activate.ps1` 被拦截：在当前 PowerShell 执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force`。
- `npm` 命令无法执行：使用 `npm.cmd`；Node/npm 太旧按 Vite 提示升级。
- SQLite 文件不存在：先运行 `python -m scripts.test_sqlite`；路径配置使用绝对项目根目录计算，不受 `cd backend` 影响。
- ChromaDB 安装时报依赖冲突：确认 Python 64 位、3.11，重查 `python -m pip check`；优先保留原错误信息排查，不盲目修改多个依赖版本。
- ChromaDB 文件被其他程序占用：只运行一个后端/写入进程，关闭其它持有同一路径的 Python 进程。
- 中文 Embedding 模型首次加载慢：Stage 2 会从模型托管站下载权重，需网络和磁盘空间；Stage 0 的 `test_chroma.py` 不触发下载。
- DeepSeek 401/402/404：检查 Key / 余额 / 模型名。`DEEPSEEK_MODEL=deepseek-flash` 为 2026-10 官方示例值。
- 前端显示无法连接：先访问 `http://127.0.0.1:8000/api/health`，再检查 `vite.config.ts` 的代理地址。
- `python -m pytest -q` 无法 import `app`：确保当前目录为 `backend` 且虚拟环境已激活。
- 忘记后端依赖清单：`backend/requirements.txt`；安装成功后可记录精确版本：

  ```powershell
  Set-Location 'C:\Users\Kirino\Desktop\interview_system'
  python -m pip freeze > .\backend\requirements-lock-windows-py312.txt
  ```

  这份锁定清单用于备份本机成功环境；后续如果升级核心依赖，重新验证测试再更新。前端用 `package-lock.json` 锁依赖。

### 重要：删除/备份本地数据

`storage/data/interview.db`、`storage/chroma/` 和 `storage/uploads/` 都是**本机真实数据**。不要在“清理缓存”时删除它们。可定期在后端停止后，将整个 `storage/` 复制备份；在新增文件和向量数据尚未出现时，备份也应保留三类目录的一致性。

## 13. 官方参考链接

- DeepSeek API：<https://api-docs.deepseek.com/zh-cn/>
- Vite：<https://vite.dev/guide/>
- Tailwind CSS + Vite：<https://tailwindcss.com/docs/installation/using-vite>
- FastAPI：<https://fastapi.tiangolo.com/>
- Chroma 本地持久客户端：<https://docs.trychroma.com/docs/run-chroma/persistent-client>
- Chroma 部署模式（嵌入式写入注意事项）：<https://cookbook.chromadb.dev/running/deployment-patterns/>
- SQLAlchemy SQLite：<https://docs.sqlalchemy.org/en/20/dialects/sqlite.html>

## 14. 以后如何持续更新本文件

每次完成一个阶段，**仅在下方添加新日期/阶段日志**，不要删除已有日志。更新的顺序：① 新增或修改文件表 ② 执行过的命令 ③ 安装新依赖 ④ 测试结果 ⑤ 未解决问题 ⑥ 下一阶段。若需改技术架构，先写“决策记录”，说明原因、影响和数据迁移方案。

你以后可以这样给 AI 提需求：

> 项目地址是 `C:\Users\Kirino\Desktop\interview_system`，虚拟环境叫 `.venvs\interview_system`。请先阅读 `PROJECT_GUIDE.md` 和当前源代码，严格按该架构继续 Stage N 的开发；提供具体文件路径、完整代码、PowerShell 命令、测试方法，并在工程文档末尾追加本次开发日志。不要改动已经可运行的 Stage 0 功能。

---

## 开发日志（只追加）

### 2026-10-15 · Stage 0 初稿（历史）

- 第一版工程骨架原计划采用 PostgreSQL + pgvector + Docker；仅为设计和文件准备，不能据此认定用户本机已成功安装。
- 确定单一 DeepSeek LLM，简历结构化存储、资料 RAG 检索。

### 2026-10-15 · Stage 0 本机部署修订（V1.2，本轮）

- **决策**：根据“不要 Docker，尽量降低安装难度”，改为 SQLite（业务数据）+ ChromaDB Embedded PersistentClient（补充资料向量）。不需要部署数据库容器，不需要安装 PostgreSQL/pgvector。
- **变更文件**：`PROJECT_GUIDE.md`、`.env.example`、`.gitignore`、`backend/requirements.txt`、`backend/app/core/config.py`；新增 `backend/scripts/test_sqlite.py`、`backend/scripts/test_chroma.py`；移除 `docker-compose.yml`。
- **测试发现**：新增 `backend/pytest.ini`，限定 pytest 只扫描 `tests/`，避免脚本目录中需要特定依赖和 API Key 的手工连通性脚本被当作单元测试收集。
- **保留**：`backend/app/main.py`、`backend/scripts/test_deepseek.py`、`backend/tests/test_health.py`（与新配置兼容）。
- **本机实际安装状态**：未知，尚待用户按照第 1~7 节执行；此处不勾选通过。
- **下一步**：验证 Python 版本、venv、pip check、SQLite、Chroma、DeepSeek、前后端连通性后进入 Stage 1 简历解析。

### [YYYY-MM-DD] Stage N 开发记录模板

- 阶段：
- 状态：未开始 / 进行中 / 已完成
- 修改/新增文件：
- 本次安装依赖与命令：
- 执行过的测试和结果：
- 遇到的问题及处理：
- 下一个开发任务：

---

## 15. Stage 1A：后端第一批业务代码（2026-10-15）

### 15.1 本阶段范围与重要决策

**目标**：先让 FastAPI 具备“面试配置选项 + 自适应调整规则预览”的可运行接口，为后续 DeepSeek 提问和会话存储铺路。**目前没有正式面试接口、没有调用 DeepSeek、没有数据库迁移，不允许把规则预览误认为真实面试。**

- 评委风格：`friendly` 和善型、`neutral` 标准型、`pressure` 压力型（严格追问，但不得辱骂/羞辱/攻击用户）；风格不改变评分标准。
- 初始难度：1~5 级，用户开始面试时选择。
- 自适应灵敏度：0 关闭、1 温和、2 标准、3 积极。**它控制多少轮连续表现才调整一次，而不是每次跳多个难度等级**；每次最多变化一级，防止突变。
- 依据：后续由**服务器端**使用 LLM 评价回答的任务表现（0~100 分，含评分依据）及用户主动反馈（`too_hard`、`too_easy`、`just_right`）。不通过答题字数或停顿推断心理状态，也不做临床判断。
- 自适应分值规则（试行，需要后续真实样本校准）：分数 >= 80 算高表现，< 50 算低表现，其他清零连续计数；温和模式 3 次高表现升一级、2 次低表现降一级；标准模式 2 次高表现升一级、1 次低表现降一级；积极模式 1 次高表现升一级、1 次低表现降一级。
- 用户主动请求更容易/更困难始终优先，即使自动调难关闭也生效；边界被限制在 1~5。`just_right` 暂不改变自动调整规则，未来可作为信号再评估。
- `POST /api/interviews/adaptation/preview` 允许传一个测试分数，仅用于开发预览；**正式面试接口绝对不能相信浏览器传来的 answer_score**。真正分数来自后端模型调用，并在数据库记录。
- 此阶段不新增 Python 依赖；沿用 Stage 0 的 `fastapi`、`pydantic`、`pytest`、`httpx`。

### 15.2 执行顺序（PowerShell）

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend

New-Item -ItemType Directory -Force -Path .\app\schemas, .\app\services, .\app\api | Out-Null
New-Item -ItemType File -Force -Path .\app\schemas\__init__.py, .\app\services\__init__.py, .\app\api\__init__.py | Out-Null

# 按 15.3 所示将各段代码复制到对应文件。
python -m pytest -q
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

浏览器访问 `http://127.0.0.1:8000/docs`、`http://127.0.0.1:8000/api/interviews/options`。然后在 Swagger 页面展开 `POST /api/interviews/adaptation/preview` 点击 Try it out，发送：

```json
{
  "config": {"reviewer_style":"pressure", "initial_difficulty":3, "adaptation_level":2, "question_count":8, "max_followups":1},
  "current_difficulty":3,
  "answer_score":90,
  "user_feedback":"none",
  "positive_streak":1,
  "negative_streak":0
}
```

预期返回 `next_difficulty: 4`、`changed: true`（两次连续高分触发升一级）。

### 15.3 必须创建/替换的文件（完整源代码）

依次新建三个业务模块：

| 路径（相对于 `backend/`） | 操作 | 功能 |
|---|---|---|
| `app/schemas/__init__.py` | 新建空文件 | Python 包 |
| `app/schemas/interview.py` | 新建 | 配置、请求、响应数据模型 |
| `app/services/__init__.py` | 新建空文件 | Python 包 |
| `app/services/adaptation.py` | 新建 | 评委系统提示词 + 自适应纯函数 |
| `app/api/__init__.py` | 新建空文件 | Python 包 |
| `app/api/interviews.py` | 新建 | 两个测试/配置接口 |
| `app/main.py` | **覆盖替换（先备份原文件）** | 注册新路由，保留健康接口与 CORS |
| `tests/test_interview_config.py` | 新建 | 规则与接口测试 |

#### `backend/app/schemas/interview.py`

```python
"""面试设置与自适应规则的数据模型。"""

from typing import Literal

from pydantic import BaseModel, Field

ReviewerStyle = Literal["friendly", "neutral", "pressure"]
UserFeedback = Literal["none", "too_hard", "too_easy", "just_right"]


class InterviewConfig(BaseModel):
    reviewer_style: ReviewerStyle = "neutral"
    initial_difficulty: int = Field(default=3, ge=1, le=5)
    adaptation_level: int = Field(default=2, ge=0, le=3)
    question_count: int = Field(default=8, ge=3, le=30)
    max_followups: int = Field(default=1, ge=0, le=2)


class AdaptationPreviewRequest(BaseModel):
    config: InterviewConfig
    current_difficulty: int = Field(ge=1, le=5)
    answer_score: float | None = Field(default=None, ge=0, le=100)
    user_feedback: UserFeedback = "none"
    positive_streak: int = Field(default=0, ge=0, le=30)
    negative_streak: int = Field(default=0, ge=0, le=30)


class AdaptationPreviewResponse(BaseModel):
    previous_difficulty: int
    next_difficulty: int
    changed: bool
    reason: str
    positive_streak: int
    negative_streak: int
```

#### `backend/app/services/adaptation.py`

```python
"""可测试的自适应难度规则：不依赖 LLM，也不推测用户心理。"""

from app.schemas.interview import (
    AdaptationPreviewRequest,
    AdaptationPreviewResponse,
    ReviewerStyle,
)


REVIEWER_PROMPTS: dict[ReviewerStyle, str] = {
    "friendly": (
        "你是一位和善、专业的模拟面试官。语气温和，允许候选人思考；"
        "回答不完整时先做简短引导，再追问关键依据。不要降低评价标准。"
    ),
    "neutral": (
        "你是一位客观、专业的模拟面试官。提问清晰直接，"
        "根据候选人回答追问关键事实、工作贡献与决策理由。"
    ),
    "pressure": (
        "你是一位要求严格的压力型模拟面试官。提问简洁、节奏紧凑，"
        "要求候选人给出明确证据并指出逻辑漏洞；"
        "不得辱骂、贬低、威胁或使用人身攻击。"
    ),
}


def reviewer_instruction(style: ReviewerStyle) -> str:
    """Stage 3 拼接 DeepSeek system prompt 时使用。"""
    return REVIEWER_PROMPTS[style]


def adjust_difficulty(data: AdaptationPreviewRequest) -> AdaptationPreviewResponse:
    """每答完一题最多变动一级；用户显式反馈优先于自动评分。"""
    old = data.current_difficulty
    up = data.positive_streak
    down = data.negative_streak
    new = old
    reason = "没有足够证据，保持当前难度"

    if data.user_feedback == "too_hard":
        new = max(1, old - 1)
        up, down = 0, 0
        reason = "用户主动要求降低难度"
    elif data.user_feedback == "too_easy":
        new = min(5, old + 1)
        up, down = 0, 0
        reason = "用户主动要求提高难度"
    elif data.config.adaptation_level == 0:
        up, down = 0, 0
        reason = "自动调难已关闭"
    elif data.answer_score is None:
        reason = "当前没有可用的答案评分，保持难度"
    else:
        score = data.answer_score
        if score >= 80:
            up += 1
            down = 0
        elif score < 50:
            down += 1
            up = 0
        else:
            up, down = 0, 0

        required_up = {1: 3, 2: 2, 3: 1}[data.config.adaptation_level]
        required_down = {1: 2, 2: 1, 3: 1}[data.config.adaptation_level]
        if up >= required_up:
            new = min(5, old + 1)
            up, down = 0, 0
            reason = "连续高质量回答，适度增加难度"
        elif down >= required_down:
            new = max(1, old - 1)
            up, down = 0, 0
            reason = "连续低分回答，适度降低难度"
        else:
            reason = "继续观察回答表现，暂不调整难度"

    if new == old and (data.user_feedback in ("too_hard", "too_easy")):
        reason = "已达到难度边界，保持当前难度"
    return AdaptationPreviewResponse(
        previous_difficulty=old,
        next_difficulty=new,
        changed=new != old,
        reason=reason,
        positive_streak=up,
        negative_streak=down,
    )
```

#### `backend/app/api/interviews.py`

```python
"""Stage 1A：面试选项与自适应规则预览（尚未创建真实会话）。"""

from fastapi import APIRouter

from app.schemas.interview import AdaptationPreviewRequest, AdaptationPreviewResponse
from app.services.adaptation import adjust_difficulty

router = APIRouter(prefix="/api/interviews", tags=["interviews"])


@router.get("/options")
def get_interview_options() -> dict:
    return {
        "reviewer_styles": [
            {"value": "friendly", "label": "和善型"},
            {"value": "neutral", "label": "标准型"},
            {"value": "pressure", "label": "压力型"},
        ],
        "difficulty_levels": [1, 2, 3, 4, 5],
        "adaptation_levels": [
            {"value": 0, "label": "关闭自动调难"},
            {"value": 1, "label": "温和调整"},
            {"value": 2, "label": "标准调整"},
            {"value": 3, "label": "积极调整"},
        ],
        "defaults": {
            "reviewer_style": "neutral",
            "initial_difficulty": 3,
            "adaptation_level": 2,
            "question_count": 8,
            "max_followups": 1,
        },
    }


@router.post("/adaptation/preview", response_model=AdaptationPreviewResponse)
def preview_adaptation(body: AdaptationPreviewRequest) -> AdaptationPreviewResponse:
    """规则调试接口；真实面试评分必须在服务器端产生。"""
    return adjust_difficulty(body)
```

#### `backend/app/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.interviews import router as interviews_router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(title="Interview System API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in settings.cors_origins.split(",") if item.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(interviews_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "interview-system-api"}
```

#### `backend/tests/test_interview_config.py`

```python
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.interview import AdaptationPreviewRequest, InterviewConfig
from app.services.adaptation import adjust_difficulty, reviewer_instruction

client = TestClient(app)


def test_options_has_reviewer_types() -> None:
    response = client.get("/api/interviews/options")
    assert response.status_code == 200
    values = {item["value"] for item in response.json()["reviewer_styles"]}
    assert values == {"friendly", "neutral", "pressure"}


def test_strict_configuration_validation() -> None:
    response = client.post(
        "/api/interviews/adaptation/preview",
        json={"config": {"adaptation_level": 8}, "current_difficulty": 3},
    )
    assert response.status_code == 422


def test_user_feedback_is_prioritized_even_when_auto_off() -> None:
    data = AdaptationPreviewRequest(
        config=InterviewConfig(adaptation_level=0),
        current_difficulty=3,
        answer_score=99,
        user_feedback="too_hard",
    )
    result = adjust_difficulty(data)
    assert result.next_difficulty == 2
    assert result.changed is True


def test_standard_requires_two_good_answers() -> None:
    request = {"config": {"adaptation_level": 2}, "current_difficulty": 3, "answer_score": 90}
    first = client.post("/api/interviews/adaptation/preview", json=request).json()
    assert first["next_difficulty"] == 3
    assert first["positive_streak"] == 1
    request["positive_streak"] = first["positive_streak"]
    second = client.post("/api/interviews/adaptation/preview", json=request).json()
    assert second["next_difficulty"] == 4
    assert second["positive_streak"] == 0


def test_no_score_means_no_automatic_changes() -> None:
    result = adjust_difficulty(
        AdaptationPreviewRequest(config=InterviewConfig(), current_difficulty=3)
    )
    assert result.next_difficulty == 3


def test_difficulty_stays_within_bounds() -> None:
    result = adjust_difficulty(
        AdaptationPreviewRequest(
            config=InterviewConfig(), current_difficulty=5, user_feedback="too_easy"
        )
    )
    assert result.next_difficulty == 5


def test_pressure_prompt_has_safety_boundary() -> None:
    assert "不得辱骂" in reviewer_instruction("pressure")
```

### 15.4 验收、边界与后续计划

| 检查项 | 方法 | 预期 |
|---|---|---|
| 旧健康接口 | `GET /api/health` | HTTP 200 且 status=ok |
| 新配置接口 | `GET /api/interviews/options` | 3 种风格、4 档调整级别 |
| 规则预览 | `POST /api/interviews/adaptation/preview` | 根据评分、连续次数与主动反馈调整 |
| 参数防错 | 发送 `adaptation_level: 9` | HTTP 422 |
| 单元测试 | `python -m pytest -q` | 既有健康检查 + 本轮新增测试通过 |
| 真实面试 | **本轮未实现** | 下阶段接简历 + DeepSeek |

下一次优先做 **Stage 1B：简历上传、文本提取、结构化 JSON、SQLite 数据表、删除接口和上传测试**。随后做 Stage 2 资料 RAG，再在 Stage 3 将上述风格和难度策略用于 DeepSeek 正式面试。

### 2026-10-15 · Stage 1A 开发记录（V1.3，本轮）

- **需求更新**：增加评委风格（压力/和善/标准）与由用户选择灵敏度的自适应难度。
- **新增**：`backend/app/schemas/interview.py`、`backend/app/services/adaptation.py`、`backend/app/api/interviews.py`、`backend/tests/test_interview_config.py` 以及对应 `__init__.py` 空包文件。
- **修改**：`backend/app/main.py` 注册业务 router；修订 `PROJECT_GUIDE.md` 当前环境说明为 Python 3.12.9。
- **依赖新增**：无。
- **验证范围**：在隔离容器 Python 3.13.5 环境执行了 `pytest -q`，8 个测试通过（包括原健康测试）。这不等于已经验证用户的 Windows 3.12.9 环境。
- **未实现/待办**：无实际面试会话、数据库持久化、简历上传、DeepSeek 问答/RAG；评分阈值暂为可解释的初始规则，后续需要用真实题目校准。
- **下一步**：Stage 1B 简历上传、解析和 SQLite 存储。

---

## 16. Stage 1B：简历上传、解析、SQLite 持久化（2026-10-15）

### 16.1 本轮目的、边界及与既有代码的兼容性

**本轮实现**：在已经完成的 Stage 1A 后端中，增加 4 个简历接口——上传、列表、详情、删除。用户上传 PDF/DOCX 时提取文字、以规则划分工作/项目/技能等章节；原文与结构化 JSON 存 SQLite、原文件存本地目录。**不调用 DeepSeek、不进行图片 OCR、不把简历放向量库**。补充资料 RAG 留待 Stage 2。

**保持不变**：`backend/app/api/interviews.py`、`backend/app/schemas/interview.py`、`backend/app/services/adaptation.py` 等 Stage 1A 文件，及 `backend/app/core/config.py`、既有 `backend/requirements.txt`。**本轮无需 pip 安装新包**：PyMuPDF、python-docx、SQLAlchemy、python-multipart、pytest 已在 Stage 0 依赖中。

**接口说明固定文档**：项目根目录新增 `API_DOCUMENTATION.md`。以后任何 API 变化都须更新该文件的接口总表、请求响应示例、错误码与变更记录；工程安装/代码和阶段记录继续写本 `PROJECT_GUIDE.md`，**两个文件长期保留各自原名**。

**MVP 注意事项**：只适合本机单用户使用。上传仅允许 `.pdf`、`.docx`，最大 8 MiB，扫描 PDF 不支持；规则解析属于初稿，不能识别所有复杂排版。所有原文保留供后续面试使用，切勿依靠正则抽取结果判断某段经历一定不存在。尚无登录鉴权；仅绑定 127.0.0.1，不要将含私人简历的 API 暴露公网。

### 16.2 新建及修改文件

| 文件（`backend/` 相对路径） | 操作 | 内容 |
|---|---|---|

| `app/core/database.py` | 新增 | SQLite 引擎、Session 依赖、初始化表 |

| `app/models/__init__.py` | 新增（空包） | 模型包 |

| `app/models/resume.py` | 新增 | resumes 表模型 |

| `app/schemas/resume.py` | 新增 | 响应 JSON 模型 |

| `app/services/resume_parser.py` | 新增 | PDF/DOCX 文本解析与规则章节提取 |

| `app/api/resumes.py` | 新增 | 简历上传/列表/详情/删除路由 |

| `app/main.py` | 修改（替换时先备份） | 保留 Stage 1A router 与健康接口，添加 resumes router 和建表 lifespan |

| `tests/test_resumes.py` | 新增 | 用临时 SQLite 验证接口及不合法文件 |


`app/models/__init__.py` 只需一个空文件；其余下面给出**可以直接粘贴**的完整代码。**不要删除现有 `app/core/config.py`**。如果你后来已自行扩展 `app/main.py`，不要粗暴覆盖；参照本文新代码仅增加 import、`lifespan` 和 `include_router`，保留自定义功能。

#### 先激活环境并创建文件夹（PowerShell）

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend

New-Item -ItemType Directory -Force .\app\models | Out-Null
New-Item -ItemType File -Force .\app\models\__init__.py | Out-Null
# app/core、app/api、app/schemas、app/services、tests 已在此前阶段存在
# 其余文件按下文使用 VS Code 创建或覆盖
code .
```

**注意**：`New-Item -Force` 对已有文件可能覆盖，以上只对新增 `__init__.py` 使用。已经存在同名文件时先检查，不要损坏个人改动。

### 16.3 完整代码（本次）


#### `backend/app/core/database.py`

```python
"""SQLite 连接与数据库会话（Stage 1B）。"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()
settings.sqlite_file.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """仅适用于本地 MVP 的初始建表；今后用 Alembic 管理结构变更。"""
    from app.models.resume import Resume  # noqa: F401  注册模型

    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```


#### `backend/app/models/resume.py`

```python
"""简历元数据、原文与初步结构化结果。"""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    full_text: Mapped[str] = mapped_column(Text, nullable=False)
    structured_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
```


#### `backend/app/schemas/resume.py`

```python
"""简历接口响应模型。"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ResumeListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    file_size: int
    created_at: datetime


class ResumeDetail(ResumeListItem):
    full_text: str
    structured_data: dict[str, Any]
```


#### `backend/app/services/resume_parser.py`

```python
"""离线提取 PDF/DOCX 正文及标题分区，不调用 DeepSeek。"""

import io
import re
import zipfile
from pathlib import Path
from typing import Any

import fitz
from docx import Document

MAX_RESUME_TEXT_CHARS = 100_000
MAX_DOCX_UNCOMPRESSED = 50 * 1024 * 1024

SECTION_ALIASES = {
    "education": ("教育经历", "教育背景", "教育信息", "education"),
    "experience": ("工作经历", "实习经历", "工作经验", "实习经验", "employment", "experience"),
    "projects": ("项目经历", "项目经验", "项目实践", "项目介绍", "projects", "project experience"),
    "skills": ("专业技能", "技术技能", "个人技能", "技能清单", "技能", "skills", "technical skills"),
    "awards": ("获奖经历", "荣誉奖项", "证书", "荣誉", "awards", "certifications"),
}


def extract_resume_text(content: bytes, extension: str) -> str:
    """提取可选中的文本；图片扫描版 PDF 需要未来加入 OCR。"""
    if extension == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("文件内容不是有效的 PDF")
        try:
            with fitz.open(stream=content, filetype="pdf") as document:
                if document.page_count > 80:
                    raise ValueError("简历最多支持 80 页")
                text = "\n".join(page.get_text(sort=True) for page in document)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("PDF 无法解析，可能已损坏或已加密") from exc

    elif extension == ".docx":
        if not content.startswith(b"PK"):
            raise ValueError("文件内容不是有效的 DOCX")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                infos = archive.infolist()
                if len(infos) > 1000 or sum(i.file_size for i in infos) > MAX_DOCX_UNCOMPRESSED:
                    raise ValueError("DOCX 解压后体积过大，拒绝处理")
            document = Document(io.BytesIO(content))
            lines = [p.text for p in document.paragraphs]
            for table in document.tables:
                for row in table.rows:
                    lines.append(" | ".join(cell.text for cell in row.cells))
            text = "\n".join(lines)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("DOCX 无法解析，可能已损坏") from exc

    else:
        raise ValueError("只支持 PDF 和 DOCX 简历")

    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not normalized:
        raise ValueError("未提取到文字，请上传可复制文字的简历；扫描版暂不支持")
    if len(normalized) > MAX_RESUME_TEXT_CHARS:
        raise ValueError("简历文本超过 100000 字符，请精简后重新上传")
    return normalized


def _section_title(line: str) -> str | None:
    candidate = re.sub(r"[\s:：\-—|┃【】\[\]]", "", line).lower()
    for section, names in SECTION_ALIASES.items():
        if candidate in {re.sub(r"\s", "", value).lower() for value in names}:
            return section
    return None


def parse_resume_sections(text: str) -> dict[str, Any]:
    """只从原文中摘录，不补写项目事实，也不推断心理状态。"""
    sections: dict[str, list[str]] = {
        "profile": [], "education": [], "experience": [],
        "projects": [], "skills": [], "awards": [], "other": [],
    }
    current = "profile"
    for line in text.splitlines():
        detected = _section_title(line)
        if detected is not None:
            current = detected
            continue
        sections[current].append(line)

    email_match = re.search(r"[\w.+\-]+@[\w.\-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text)
    name_match = re.search(r"(?:姓名|Name)\s*[:：]\s*([^\s|,，]{2,30})", text, re.I)

    return {
        "name": name_match.group(1) if name_match else None,
        "email": email_match.group(0) if email_match else None,
        "phone": phone_match.group(0) if phone_match else None,
        "sections": sections,
        "extraction_method": "rule_based_v1",
    }
```


#### `backend/app/api/resumes.py`

```python
"""简历 CRUD：文件保存在本机，结构化数据保存在 SQLite。"""

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.resume import Resume
from app.schemas.resume import ResumeDetail, ResumeListItem
from app.services.resume_parser import extract_resume_text, parse_resume_sections

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/resumes", tags=["resumes"])
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx"}


def _resume_or_404(resume_id: str, db: Session) -> Resume:
    resume = db.get(Resume, resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="简历不存在")
    return resume


@router.post("", response_model=ResumeDetail, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Resume:
    # 文件名仅用于展示；持久化时使用 UUID 文件名，防止路径穿越。
    original_name = Path((file.filename or "").replace("\\", "/")).name
    extension = Path(original_name).suffix.lower()
    if not original_name or extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="只支持 .pdf 或 .docx 简历")

    try:
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="简历不能超过 8 MB")
    if not raw:
        raise HTTPException(status_code=422, detail="上传的文件为空")

    try:
        text = extract_resume_text(raw, extension)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    resume_id = str(uuid4())
    stored_filename = f"{resume_id}{extension}"
    folder = settings.uploads_dir / "resumes"
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / stored_filename
    destination.write_bytes(raw)

    resume = Resume(
        id=resume_id,
        original_filename=original_name[:255],
        stored_filename=stored_filename,
        file_size=len(raw),
        full_text=text,
        structured_data=parse_resume_sections(text),
    )
    try:
        db.add(resume)
        db.commit()
        db.refresh(resume)
    except SQLAlchemyError:
        db.rollback()
        destination.unlink(missing_ok=True)
        logger.exception("简历写入数据库失败")
        raise HTTPException(status_code=500, detail="保存简历失败") from None
    return resume


@router.get("", response_model=list[ResumeListItem])
def list_resumes(db: Session = Depends(get_db)) -> list[Resume]:
    return list(db.scalars(select(Resume).order_by(Resume.created_at.desc())).all())


@router.get("/{resume_id}", response_model=ResumeDetail)
def get_resume(resume_id: str, db: Session = Depends(get_db)) -> Resume:
    return _resume_or_404(resume_id, db)


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(
    resume_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    resume = _resume_or_404(resume_id, db)
    saved_path = settings.uploads_dir / "resumes" / resume.stored_filename
    db.delete(resume)
    db.commit()
    try:
        saved_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("简历记录已删除，但原文件清理失败：%s", resume_id, exc_info=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```


#### `backend/app/main.py`

```python
"""FastAPI 应用入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.interviews import router as interviews_router
from app.api.resumes import router as resumes_router
from app.core.config import get_settings
from app.core.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


settings = get_settings()
app = FastAPI(title="Interview System API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in settings.cors_origins.split(",") if item.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(interviews_router)
app.include_router(resumes_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "interview-system-api"}
```


#### `backend/tests/test_resumes.py`

```python
"""临时数据库测试，绝不使用用户真实 storage/data。"""

from io import BytesIO

import fitz
import pytest
from docx import Document
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.main import app
from app.models.resume import Resume  # noqa: F401


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    test_settings = Settings(_env_file=None, upload_path=str(tmp_path / "uploads"))

    def override_db():
        with session_factory() as session:
            yield session

    # 防止应用 lifespan 初始化用户真实的 SQLite 数据库。
    monkeypatch.setattr("app.main.init_db", lambda: None)
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: test_settings
    with TestClient(app) as test_client:
        yield test_client, tmp_path, session_factory
    app.dependency_overrides.clear()
    engine.dispose()


def docx_bytes(text: str) -> bytes:
    document = Document()
    for line in text.splitlines():
        document.add_paragraph(line)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def pdf_bytes(text: str) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    content = document.tobytes()
    document.close()
    return content


def test_upload_list_detail_delete_docx(client):
    api, temp_dir, session_factory = client
    data = docx_bytes("姓名：张三\n项目经历\n客服助手系统\n技能\nPython")
    response = api.post("/api/resumes", files={"file": ("my-resume.docx", data)})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["structured_data"]["name"] == "张三"
    assert "客服助手系统" in body["structured_data"]["sections"]["projects"]
    resume_id = body["id"]
    assert len(api.get("/api/resumes").json()) == 1
    assert api.get(f"/api/resumes/{resume_id}").json()["id"] == resume_id
    saved_files = list((temp_dir / "uploads" / "resumes").glob("*.docx"))
    assert len(saved_files) == 1
    result = api.delete(f"/api/resumes/{resume_id}")
    assert result.status_code == 204
    assert api.get(f"/api/resumes/{resume_id}").status_code == 404
    assert not saved_files[0].exists()
    with session_factory() as db:
        assert db.get(Resume, resume_id) is None


def test_pdf_upload(client):
    api, _, _ = client
    response = api.post(
        "/api/resumes", files={"file": ("resume.pdf", pdf_bytes("Python engineer"))}
    )
    assert response.status_code == 201, response.text
    assert "Python engineer" in response.json()["full_text"]


def test_invalid_extension(client):
    api, _, _ = client
    response = api.post("/api/resumes", files={"file": ("resume.txt", b"hello")})
    assert response.status_code == 415


def test_invalid_docx(client):
    api, _, _ = client
    response = api.post("/api/resumes", files={"file": ("bad.docx", b"not a docx")})
    assert response.status_code == 422


def test_file_size_limit(client):
    api, _, _ = client
    response = api.post(
        "/api/resumes", files={"file": ("too-big.pdf", b"a" * (8 * 1024 * 1024 + 1))}
    )
    assert response.status_code == 413


def test_empty_pdf_without_text(client):
    api, _, _ = client
    document = fitz.open()
    document.new_page()
    raw = document.tobytes()
    document.close()
    response = api.post("/api/resumes", files={"file": ("scan.pdf", raw)})
    assert response.status_code == 422
    assert "扫描版" in response.json()["detail"]


def test_file_path_traversal_is_not_used(client):
    api, temp_dir, _ = client
    response = api.post(
        "/api/resumes", files={"file": ("../../somebody.docx", docx_bytes("项目经历\n系统开发"))}
    )
    assert response.status_code == 201
    assert response.json()["original_filename"] == "somebody.docx"
    assert not (temp_dir / "somebody.docx").exists()
```


### 16.4 SQLite 数据表及 API 返回格式

首次启动服务时执行 `init_db()`，创建 `resumes` 表（若尚不存在），不会删除旧数据库/其它表，也不会清空已上传文件。当前字段：`id` UUID 字符串主键、`original_filename`、`stored_filename`（UUID 文件名）、`file_size`、`full_text`、`structured_data` JSON、`created_at`。**`create_all` 只会新建缺少的表，不会变更已存在表结构**，未来结构调整请使用 Alembic 迁移。

成功上传：`POST /api/resumes` → **201**，返回 `id / original_filename / file_size / created_at / full_text / structured_data`。规则结构包括 `name / email / phone / sections / extraction_method`；`sections` 含 `profile, education, experience, projects, skills, awards, other`，各为字符串数组。其它接口：`GET /api/resumes` → **200**（元数据列表），`GET /api/resumes/{resume_id}` → **200**（原文+结构化）或 **404**，`DELETE /api/resumes/{resume_id}` → **204**（空响应）或 **404**。详情及错误码以 `API_DOCUMENTATION.md` 为准。

### 16.5 运行步骤与测试（PowerShell）

```powershell
Set-Location 'C:\Users\Kirino\Desktop\interview_system'
.\.venvs\interview_system\Scripts\Activate.ps1
Set-Location .\backend

# 先进行全部回归测试；预期 15 passed（Stage 1A + Stage 1B）
python -m pytest -q

# 启动服务；首次启动自动创建 SQLite resumes 表
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

浏览器打开 `http://127.0.0.1:8000/docs`，确认原有 3 个接口 + 新增的 4 个简历接口。先选择一份**不含真实私人信息的测试简历**进行上传。你可以在 `/docs` 中点开 `POST /api/resumes` → **Try it out** → 选择 `.pdf` 或 `.docx` → **Execute**。复制返回的 `id` 到详情和删除接口中测试。

也可以使用另一个 PowerShell 终端调用：

```powershell
# 下例需确保此路径是你自己电脑上存在的文件；只是示例，不必创建同名文件
curl.exe -X POST "http://127.0.0.1:8000/api/resumes" -F "file=@C:\Users\Kirino\Desktop\my_resume.pdf"

# 列表不需要认证（只允许本机服务，不开放公网）
curl.exe "http://127.0.0.1:8000/api/resumes"
```

**常见问题**：

- `ModuleNotFoundError: sqlalchemy/fitz/docx/multipart`：确认已激活正确虚拟环境，并从项目根目录运行 `python -m pip install -r .\backend\requirements.txt`。
- `no such table: resumes`：先停止服务，确认已使用本文 Stage 1B 的 `main.py`，再重新启动以执行 `lifespan` 自动建表；测试代码的临时数据库会独立建表。
- `422 未提取到文字`：PDF 可能只有扫描图片，目前不支持 OCR；请先使用可复制文字的 PDF 或 DOCX。
- `413`：超过 8 MiB，先缩小简历。
- `415`：仅接受 PDF 或 DOCX。
- `sqlite database is locked`：本地仅启动一个后端写入进程，不要多个实例同时写同一数据库。
- **不要删除** `storage/data/interview.db` 或 `storage/uploads/resumes`，其中是用户原始数据。

### 16.6 本轮结果与下一步

- **功能范围**：简历的本地上传、解析、存储、读取与删除可在一个后端进程完成；没有调用 DeepSeek，因而不消耗模型 API 额度。
- **隔离验证**：在此工作环境执行 `python -m pytest -q` → **15 passed**。测试包括过去的健康接口/配置接口，以及新增简历的 PDF、DOCX、错误文件、大小限制、路径穿越与删除流程。**实际 Windows Python 3.12.9 环境仍需用户按 16.5 验证**。
- **已知限制**：规则提取不保证准确分栏；多页图片或扫描简历无法解析；DOCX 段落与表格的复杂交错顺序可能丢失；数据库记录删除后若 Windows 锁住原文件，可能留下孤立文件；本地 MVP 无分页/用户鉴权。
- **下一步（Stage 2）**：资料上传 → 文本切分 → 本地 `sentence-transformers` 向量化 → ChromaDB 索引、召回及来源信息；继续更新 `PROJECT_GUIDE.md` 和 `API_DOCUMENTATION.md`。

### 2026-10-15 · Stage 1B 开发日志（V1.4）

- **新增**：`app/core/database.py`、`app/models/__init__.py`、`app/models/resume.py`、`app/schemas/resume.py`、`app/services/resume_parser.py`、`app/api/resumes.py`、`tests/test_resumes.py`。
- **修改**：`app/main.py` 注册 `resumes_router`、使用 lifespan 创建 `resumes` 表，保持既有健康接口和 Stage 1A 配置路由。
- **新增文档**：根目录 `API_DOCUMENTATION.md`（以后任何后端接口变更都同步维护）。
- **新依赖**：无；使用已装的 PyMuPDF、python-docx、SQLAlchemy、FastAPI。
- **接口新增**：`POST/GET /api/resumes` 与 `GET/DELETE /api/resumes/{resume_id}`。
- **测试结果**：隔离环境 pytest 15 项通过；你自己的 Windows 机器尚待验证。
- **下一步**：Stage 2 补充资料 RAG（不把简历再嵌入向量库）。

---

<!-- Stage5A-20261016: PROJECT_GUIDE -->
## Stage 5A：React 仪表盘、历史查询与本地联调（2026-10-16）

> 文档版本升级为 V1.8；此小节仅为增量追加。用户本机验收尚待执行；本次提供的代码不代表已在用户 Windows 上通过构建。

### 阶段定位

- Stage 4：面试历史、全局统计、离线规则复盘和可选 AI 复盘后端已有代码。
- Stage 5A：React 页面，调用现有历史与统计 API；**没有新增或改动后端 HTTP 路由、SQLite 表或 ChromaDB 索引**。
- Stage 5B：简历与补充资料管理页面（待完成）；Stage 5C 创建面试、Stage 5D 多轮答题、Stage 5E 复盘可视化、Stage 5F 验收与部署均待完成。

### 本阶段前端文件

| 路径 | 职责 |
|---|---|
| `frontend/src/types/interview.ts` | 与 Stage 4 统计及历史 JSON 对齐的类型；`average_score` 可为 null |
| `frontend/src/lib/api.ts` | 相对 `/api` 的 fetch 封装；JSON/网络/HTTP 错误、AbortSignal |
| `frontend/src/pages/DashboardPage.tsx` | 4 张统计卡片、历史记录分页/筛选、加载/错误/空状态、刷新 |
| `frontend/src/App.tsx` | 根页面入口（本阶段仅渲染仪表盘） |
| `frontend/src/index.css` | Tailwind CSS v4 入口和最小 CSS 重置 |
| `frontend/vite.config.ts` | React、Tailwind 插件；`/api` 开发代理转发至 `127.0.0.1:8000` |

`frontend/src/main.tsx` 应保留 Vite 默认生成的 `import './index.css'`。不要求 React Router / TanStack Query / ECharts / Axios；本阶段仅需 `lucide-react`、`tailwindcss`、`@tailwindcss/vite` 和 Vite 默认 React 依赖。

### 本地环境与排障

用户已反馈：Windows x64、Node v24.13.0、npm v11.6.2、Vite v8.3.4。首次 `create-vite` 自动安装超过 20 分钟；改用镜像源 `https://registry.npmmirror.com` 后安装成功。首次 Vite build 遇到 `Cannot find module '../lightningcss.win32-x64-msvc.node'`，属于 Windows x64 原生可选包安装不完整。后续用户反馈依赖安装与基础工程 build 已通过。后续如再次缺失原生包，可在 `frontend` 执行 `npm.cmd install --include=optional --registry=https://registry.npmmirror.com --no-audit --no-fund`；如仍失败，备份 `package-lock.json` 后重装依赖。**不要重复初始化 Vite，也不要删除 `src`**。

### 安装/运行/联调

终端 A（项目根目录执行）：

```powershell
$python = (Resolve-Path .\.venvs\interview_system\Scripts\python.exe).Path
Set-Location .\backend
& $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

终端 B：

```powershell
Set-Location C:\Users\Kirino\Desktop\interview_system\frontend
npm.cmd install lucide-react --registry=https://registry.npmmirror.com --no-audit --no-fund
npm.cmd install -D tailwindcss @tailwindcss/vite --registry=https://registry.npmmirror.com --no-audit --no-fund
npm.cmd run build
npm.cmd run dev
```

浏览器访问 `http://127.0.0.1:5173/`，验证“全部面试/进行中/已完成”筛选、刷新、空状态和统计卡片；直接检查 `http://127.0.0.1:8000/api/interviews/statistics` 和 `http://127.0.0.1:8000/api/interviews/history?limit=8&offset=0` 的 JSON。历史为 0 是合法状态；不是前端失败。

### 验收与限制

1. 前端 `npm.cmd run build` 必须成功。若 `main.tsx` 未引入 `index.css`，需补充样式导入。
2. 两个 API 正常时，显示四个统计卡片；空历史显示空状态，平均分 null 展示 `—`。
3. 状态过滤切换时重新拉取并从第 1 页开始；每页 8 条，超过 8 条才允许翻页。
4. 后端停止时应显示重试提示；不得把错误误判为无历史数据。
5. 此阶段没有简历上传、真实面试、报告详情入口，这些留给 Stage 5B～5E，不提供无响应的假按钮。
6. 浏览器前端不得存放 DeepSeek Key、简历敏感数据或任何后端 `.env` 内容。本地单用户服务暂不对公网开放。

### 开发日志

- 2026-10-16：Vite/React 初始化，npm 镜像与 Lightning CSS 安装异常已排障；用户反馈依赖与基础构建已通过。
- 2026-10-16：交付 Stage 5A 前端源码、文档增量与 PowerShell 安装脚本；尚未收到本机前后端联调验收结果。
- 下一步：Stage 5B，简历 / 补充材料文件管理页面。
