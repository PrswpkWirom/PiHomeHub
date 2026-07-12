from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient as HttpxAsyncClient, Headers
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


class AsyncClient(HttpxAsyncClient):
    """Browser-like client that preserves the synchronizer token issued by the real app."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.csrf_token: str | None = None

    async def request(self, method: str, url, **kwargs):
        headers = Headers(kwargs.pop("headers", None))
        headers.setdefault("Origin", str(self.base_url).rstrip("/"))
        if method.upper() in {"POST", "PUT", "PATCH", "DELETE"} and self.csrf_token:
            headers.setdefault("X-CSRF-Token", self.csrf_token)
        response = await super().request(method, url, headers=headers, **kwargs)
        if token := response.headers.get("X-CSRF-Token"):
            self.csrf_token = token
        return response


def _build_test_app(
    tmp_path: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch, known_devices_json: str
) -> Generator[FastAPI, None, None]:
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("PIHOMEHUB_ENV", "testing")
    monkeypatch.setenv("PIHOMEHUB_SECRET_KEY", "testing-secret-key-that-is-long-enough")
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_SECRET", "testing-control-agent-secret-long-enough")
    monkeypatch.setenv("PIHOMEHUB_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_PASSWORD", "Test-secret-123!")
    monkeypatch.setenv("PIHOMEHUB_ALLOWED_ORIGINS", "http://testserver")
    monkeypatch.setenv("PIHOMEHUB_PUBLIC_BASE_URL", "http://testserver")
    monkeypatch.setenv("PIHOMEHUB_COMPOSE_ENV_FILE", str(tmp_path / "infra.env"))
    monkeypatch.setenv("PIHOMEHUB_HOST_PROC_NET_PATH", str(tmp_path / "proc_net"))
    monkeypatch.setenv(
        "PIHOMEHUB_SERVICE_LINKS_JSON",
        '[{"name":"Gitea","slug":"gitea","url":"http://gitea.local","description":"Git"}]',
    )
    monkeypatch.setenv("PIHOMEHUB_KNOWN_DEVICES_JSON", known_devices_json)

    from app.core.config import get_settings

    get_settings.cache_clear()

    from app.database import bootstrap
    from app.database.db import Base, get_db
    from app.main import create_app
    from app.core.security import hash_password
    from app.models.user import User

    bootstrap.settings = get_settings()
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False}, future=True)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    try:
        db.add(
            User(
                username="admin",
                password_hash=hash_password("Test-secret-123!"),
                is_admin=True,
                is_active=True,
            )
        )
        db.commit()
        bootstrap.seed_defaults(db)
    finally:
        db.close()

    async def override_get_db():
        test_db = TestingSessionLocal()
        try:
            yield test_db
        finally:
            test_db.close()

    app = create_app(include_lifespan=False)
    app.state.testing_session_local = TestingSessionLocal
    app.state.session_factory = TestingSessionLocal
    app.dependency_overrides[get_db] = override_get_db

    from app.api.auth import _attempts

    _attempts.clear()

    yield app


@pytest.fixture
async def browser_client(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        yield client


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
