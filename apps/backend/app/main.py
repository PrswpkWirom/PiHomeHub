from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import router
from app.core.config import get_settings
from app.core.middleware import RequestSecurityMiddleware
from app.database.bootstrap import bootstrap_database
from app.database.db import SessionLocal, get_db
from app.services.notification_monitor import claim_monitor_lock, monitor_loop

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    bootstrap_database()
    settings = get_settings()
    lock = claim_monitor_lock(settings.database_url)
    monitor_task = None
    if lock is None:
        logger.warning("Notification monitor is already active in another backend worker")
    else:
        session_factory = getattr(application.state, "session_factory", SessionLocal)
        monitor_task = asyncio.create_task(monitor_loop(session_factory), name="pihomehub-notification-monitor")
    try:
        yield
    finally:
        if monitor_task:
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
        if lock:
            lock.close()


def create_app(*, include_lifespan: bool = True) -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="PiHomeHub API",
        version="0.1.0",
        debug=False,
        lifespan=lifespan if include_lifespan else None,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
    )
    application.add_middleware(RequestSecurityMiddleware)
    application.include_router(router)

    @application.exception_handler(RequestValidationError)
    async def safe_validation_error(_: Request, exc: RequestValidationError):
        safe_errors = []
        for error in exc.errors():
            location = [part for part in error.get("loc", ()) if isinstance(part, (str, int))]
            safe_errors.append({
                "loc": location,
                "type": str(error.get("type", "value_error"))[:80],
                "msg": str(error.get("msg", "Invalid value"))[:200],
            })
        return JSONResponse(status_code=422, content={"detail": safe_errors})

    @application.get("/health", include_in_schema=False)
    def healthcheck(db: Session = Depends(get_db)):
        try:
            db.execute(text("SELECT 1"))
        except SQLAlchemyError:
            return JSONResponse(status_code=503, content={"status": "unavailable"})
        return {"status": "ok"}

    return application


app = create_app()
