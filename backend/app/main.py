from fastapi import FastAPI

app = FastAPI(
    title="金融制度 RAG API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)


@app.get("/api/v1/health", tags=["system"])
def health_check() -> dict[str, str]:
    """供容器编排判断后端进程是否可用。"""
    return {"status": "ok", "service": "backend"}
