"""FastAPI 应用入口。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.interviews import router as interviews_router
from app.api.resumes import router as resumes_router
from app.api.materials import router as materials_router
from app.api.sessions import router as sessions_router
from app.api.reports import router as reports_router
from app.core.config import get_settings
from app.core.database import init_db
from app.account_bootstrap import initialize_account_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_account_database()
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

# Register the static PPTX import route before resource-id paths.
from app.pptx_import import import_pptx as import_pptx_document

app.add_api_route(
    "/api/pptx-import",
    import_pptx_document,
    methods=["POST"],
    status_code=201,
    tags=["materials-pptx"],
)

# Core application routes
app.include_router(interviews_router)
app.include_router(resumes_router)
app.include_router(materials_router)

# Static report routes must precede dynamic session-id routes.
app.include_router(reports_router)

# Dynamic session-id routes
app.include_router(sessions_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "interview-system-api",
    }


# Local review and knowledge annotations
from app.knowledge_review import router as knowledge_review_router

app.include_router(knowledge_review_router)

# Local authentication middleware
from app.account_auth import install_auth as install_account_auth

install_account_auth(app)

# Per-account resource ownership checks
from app.ownership_guard import install_owner_scope as install_account_owner_scope

install_account_owner_scope(app)

# Local audio transcription
from app.speech_transcription import router as speech_router

app.include_router(speech_router)

# PPTX text indexing reuses the document material pipeline
from app.pptx_import import router as pptx_router

app.include_router(pptx_router)
