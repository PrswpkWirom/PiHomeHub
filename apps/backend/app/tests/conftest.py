from collections.abc import Generator

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _build_test_app(
    tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch, known_devices_json: str
) -> Generator[FastAPI, None, None]:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("PIHOMEHUB_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_PASSWORD", "test-secret")
    monkeypatch.setenv(
        "PIHOMEHUB_SERVICE_LINKS_JSON",
        '[{"name":"Gitea","slug":"gitea","url":"http://gitea.local","description":"Git"}]',
    )
    monkeypatch.setenv("PIHOMEHUB_KNOWN_DEVICES_JSON", known_devices_json)

    from app.core.config import get_settings

    get_settings.cache_clear()

    from app.api import router
    from app.database import bootstrap
    from app.database.db import Base, get_db

    bootstrap.settings = get_settings()
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False}, future=True)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        bootstrap.seed_defaults(db)
    finally:
        db.close()

    async def override_get_db():
        test_db = TestingSessionLocal()
        try:
            yield test_db
        finally:
            test_db.close()

    app = FastAPI()
    app.include_router(router)
    app.state.testing_session_local = TestingSessionLocal
    app.dependency_overrides[get_db] = override_get_db

    yield app


@pytest.fixture
def app(tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    yield from _build_test_app(
        tmp_path,
        monkeypatch,
        '[{"name":"Gaming Desktop","device_type":"desktop","ip_address":"127.0.0.1","mac_address":"AA:BB:CC:DD:EE:FF","supports_wol":true,"description":"Workstation"}]',
    )


@pytest.fixture
def app_without_known_devices(
    tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> Generator[FastAPI, None, None]:
    yield from _build_test_app(tmp_path, monkeypatch, "[]")
