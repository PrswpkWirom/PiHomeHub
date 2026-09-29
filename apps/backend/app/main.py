from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import router
from app.core.config import get_settings
from app.core.middleware import RequestSecurityMiddleware
from app.database.bootstrap import bootstrap_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap_database()
    yield


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
    async def healthcheck():
        return {"status": "ok"}

    return application


app = create_app()
