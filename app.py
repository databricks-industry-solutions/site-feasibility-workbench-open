"""FastAPI entry point for Clinical Trial Site Workbench."""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.routes.indications import router as indications_router
from server.routes.map_data import router as map_data_router
from server.routes.patient_data import router as patient_data_router
from server.routes.feasibility import router as feasibility_router
from server.routes.protocols import router as protocols_router
from server.routes.chat import router as chat_router
from server.routes.assessments import router as assessments_router
from server.routes.genie_chat import router as genie_chat_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Kick off Lakebase initialization in the background so the app is
    # immediately available; routes fall back to the SQL Statement API until
    # the init task sets lakebase_init.lakebase_ready = True.
    from server.lakebase_init import initialize_lakebase
    init_task = asyncio.create_task(initialize_lakebase())

    yield  # App serves requests here

    init_task.cancel()
    try:
        await init_task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Clinical Trial Site Workbench", lifespan=lifespan)

app.include_router(map_data_router, prefix="/api")
app.include_router(indications_router, prefix="/api")
app.include_router(patient_data_router, prefix="/api")
app.include_router(feasibility_router, prefix="/api")
app.include_router(protocols_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(assessments_router, prefix="/api")
app.include_router(genie_chat_router, prefix="/api")

@app.get("/health")
async def health():
    """Health check — used by Databricks Apps platform and load balancers."""
    from server.lakebase_init import lakebase_ready
    from server.db import is_lakebase_configured
    return {
        "status": "ok",
        "lakebase_configured": is_lakebase_configured(),
        "lakebase_ready": lakebase_ready,
    }

# Serve React SPA
frontend_dist = Path(__file__).parent / "frontend" / "dist"

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return {"error": "Not found"}, 404
        file_path = frontend_dist / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
