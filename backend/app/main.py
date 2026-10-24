from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.auth import router as auth_router
from app.api.v1.qa import router as qa_router
from app.api.v1.users import router as users_router
from app.core.database import initialize_database, session_factory
from app.core.exceptions import install_error_handlers
from app.services.auth.service import bootstrap_admin


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    with session_factory()() as db:
        bootstrap_admin(db)
    yield

app = FastAPI(
    title="金融制度 RAG API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

install_error_handlers(app)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(qa_router)


@app.get("/api/v1/health", tags=["system"])
def health_check() -> dict[str, str]:
    """供容器编排判断后端进程是否可用。"""
    return {"status": "ok", "service": "backend"}
