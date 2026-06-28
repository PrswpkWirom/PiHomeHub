from collections.abc import Generator

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def app(tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("PIHOMEHUB_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_PASSWORD", "test-secret")
    monkeypatch.setenv(
        "PIHOMEHUB_SERVICE_LINKS_JSON",
        '[{"name":"Gitea","slug":"gitea","url":"http://gitea.local","description":"Git"}]',
    )
    monkeypatch.setenv(
        "PIHOMEHUB_KNOWN_DEVICES_JSON",
        '[{"name":"Gaming Desktop","device_type":"desktop","ip_address":"127.0.0.1","mac_address":"AA:BB:CC:DD:EE:FF","supports_wol":true,"description":"Workstation"}]',
    )

    from app.core.config import get_settings

    get_settings.cache_clear()

    from app.api import router
    from app.database.bootstrap import seed_defaults
    from app.database.db import Base, get_db

    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False}, future=True)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        seed_defaults(db)
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
    app.dependency_overrides[get_db] = override_get_db

    yield app
