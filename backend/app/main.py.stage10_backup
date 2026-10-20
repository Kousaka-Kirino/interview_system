"""FastAPI 应用入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.interviews import (
    router as interviews_router,
)

from app.api.resumes import (
    router as resumes_router,
)

from app.api.materials import (
    router as materials_router,
)

from app.api.sessions import (
    router as sessions_router,
)

# Stage 4
from app.api.reports import (
    router as reports_router,
)

from app.core.config import get_settings
from app.core.database import init_db

@asynccontextmanager
async def lifespan(app: FastAPI):

    init_db()

    yield

settings = get_settings()

app = FastAPI(
    title="Interview System API",
    version="0.6.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        item.strip()
        for item in settings.cors_origins.split(",")
        if item.strip()
    ],

    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 原有接口
app.include_router(interviews_router)
app.include_router(resumes_router)
app.include_router(materials_router)

# Stage 4：静态 history/statistics 路由先注册
app.include_router(reports_router)

# Stage 3：包含 /{session_id} 动态路由
app.include_router(sessions_router)

@app.get("/api/health")
def health() -> dict[str, str]:

    return {
        "status": "ok",
        "service": "interview-system-api",
    }

# stage7:router - local review and knowledge annotations
from app.stage7_review import router as stage7_review_router
app.include_router(stage7_review_router)

# stage8b:auth - local single-owner login barrier
from app.stage8b_auth import install_auth as stage8b_install_auth
stage8b_install_auth(app)

# stage8c2:scope - primary-resource ownership checks (single-owner transition)
from app.stage8c2_guard import install_owner_scope as stage8c2_install_owner_scope
stage8c2_install_owner_scope(app)

# stage9:voice - local audio transcription router
from app.stage9_speech import router as stage9_speech_router
app.include_router(stage9_speech_router)

# stage10:pptx-import -- reuse existing DOCX material indexing route
from app.stage10_pptx import router as stage10_pptx_router
app.include_router(stage10_pptx_router)
