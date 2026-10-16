from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, load_settings
from app.core.errors import register_error_handlers
from app.middleware.body_limit import MAX_PAGE_BYTES, BodySizeLimitMiddleware
from app.routes.verify import router
from app.services.verifier import Verifier, build_verifier

DEV_ORIGINS = ["http://localhost:3000"]
PURGE_INTERVAL_SECONDS = 3600

logger = logging.getLogger(__name__)


async def _purge_once(verifier: Verifier) -> None:
    try:
        await run_in_threadpool(verifier.quota.purge)
        await run_in_threadpool(verifier.cache.purge)
    except Exception:
        logger.exception("purge de cota/cache falhou")


async def _purge_loop(verifier: Verifier) -> None:
    while True:
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)
        await _purge_once(verifier)


def create_app(settings: Settings | None = None, verifier: Verifier | None = None) -> FastAPI:
    settings = settings or load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    owns_verifier = verifier is None
    verifier = verifier or build_verifier(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if owns_verifier:
            await _purge_once(verifier)
            task = asyncio.create_task(_purge_loop(verifier))
        yield
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    docs = not settings.is_production
    app = FastAPI(
        title="Verifica API",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.verifier = verifier

    register_error_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware, path_limits={"/api/analyze-page": MAX_PAGE_BYTES})
    if not settings.is_production:
        app.add_middleware(
            CORSMiddleware, allow_origins=DEV_ORIGINS, allow_methods=["POST"], allow_headers=["Content-Type"]
        )

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    app.include_router(router)
    return app
