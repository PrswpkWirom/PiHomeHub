from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.core.config import get_settings
from app.database.bootstrap import bootstrap_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap_database()
    yield


settings = get_settings()

app = FastAPI(
    title="PiHomeHub API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def healthcheck():
    return {"status": "ok"}
