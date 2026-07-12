from __future__ import annotations

import hashlib
from datetime import timedelta
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient as RawAsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings, get_settings
from app.core.security import hash_password, utc_now
from app.database.db import Base
from app.models.user import AuditEvent, SessionToken, User
from app.tests.conftest import AsyncClient


async def _login(client: AsyncClient, username: str = "admin", password: str = "Test-secret-123!"):
    response = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response


def test_bootstrap_never_creates_administrator_from_legacy_environment(tmp_path, monkeypatch):
    from app.database import bootstrap

    database = tmp_path / "legacy-environment.db"
    engine = create_engine(f"sqlite:///{database}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine)()
    monkeypatch.setattr(
        bootstrap,
        "settings",
        Settings(
            env="development",
            database_url=f"sqlite:///{database}",
            admin_username="admin",
            admin_password="change-me-now",
            service_links_json="[]",
            known_devices_json="[]",
        ),
    )
    try:
        bootstrap.seed_defaults(test_session)
        assert test_session.query(User).count() == 0
    finally:
        test_session.close()


def _add_viewer(app) -> User:
    db = app.state.testing_session_local()
    try:
        viewer = User(
            username="viewer",
            password_hash=hash_password("Viewer-password-123!"),
            is_admin=False,
            is_active=True,
        )
        db.add(viewer)
        db.commit()
        db.refresh(viewer)
        db.expunge(viewer)
        return viewer
    finally:
        db.close()


@pytest.mark.anyio
async def test_session_stores_only_hash_and_cookie_has_security_attributes(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await _login(client)
        raw_token = client.cookies[get_settings().cookie_name]

    db = app.state.testing_session_local()
    try:
        session = db.query(SessionToken).one()
        assert session.token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
        assert raw_token not in session.token_hash
        assert not hasattr(session, "token")
    finally:
        db.close()
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie


@pytest.mark.anyio
async def test_csrf_and_origin_are_enforced_by_real_app(app):
    async with RawAsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login = await client.post(
            "/api/auth/login",
            headers={"Origin": "http://testserver"},
            json={"username": "admin", "password": "Test-secret-123!"},
        )
        assert login.status_code == 200
        token = login.headers["X-CSRF-Token"]

        missing = await client.post("/api/tasks", headers={"Origin": "http://testserver"}, json={"title": "x"})
        invalid = await client.post(
            "/api/tasks",
            headers={"Origin": "http://testserver", "X-CSRF-Token": "wrong"},
            json={"title": "x"},
        )
        untrusted = await client.post(
            "/api/tasks",
            headers={"Origin": "https://evil.example", "X-CSRF-Token": token},
            json={"title": "x"},
        )
        valid = await client.post(
            "/api/tasks",
            headers={"Origin": "http://testserver", "X-CSRF-Token": token},
            json={"title": "x"},
        )
        safe_get = await client.get("/api/tasks")

    assert missing.status_code == 403
    assert invalid.status_code == 403
    assert untrusted.status_code == 403
    assert valid.status_code == 201
    assert safe_get.status_code == 200


@pytest.mark.anyio
async def test_login_with_stale_session_cookie_does_not_require_csrf(app):
    async with RawAsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        client.cookies.set(get_settings().cookie_name, "stale-session-token")
        response = await client.post(
            "/api/auth/login",
            headers={"Origin": "http://testserver"},
            json={"username": "admin", "password": "Test-secret-123!"},
        )
    assert response.status_code == 200
    assert response.json()["username"] == "admin"


@pytest.mark.anyio
async def test_expired_idle_absolute_revoked_deleted_and_disabled_sessions_are_rejected(app):
    cases = ("idle", "absolute", "revoked", "deleted", "disabled")
    for case in cases:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            await _login(client)
            db = app.state.testing_session_local()
            try:
                session = db.query(SessionToken).filter(SessionToken.revoked_at.is_(None)).order_by(SessionToken.id.desc()).first()
                user = db.query(User).filter(User.id == session.user_id).one()
                if case == "idle":
                    session.last_seen_at = utc_now() - timedelta(days=1)
                elif case == "absolute":
                    session.expires_at = utc_now() - timedelta(seconds=1)
                elif case == "revoked":
                    session.revoked_at = utc_now()
                elif case == "deleted":
                    db.delete(user)
                else:
                    user.is_active = False
                db.commit()
            finally:
                db.close()
            response = await client.get("/api/auth/me")
            assert response.status_code == 401, case

        if case in {"deleted", "disabled"}:
            db = app.state.testing_session_local()
            try:
                if case == "deleted":
                    db.add(
                        User(
                            username="admin",
                            password_hash=hash_password("Test-secret-123!"),
                            is_admin=True,
                            is_active=True,
                        )
                    )
                else:
                    db.query(User).filter(User.username == "admin").update({User.is_active: True})
                db.commit()
            finally:
                db.close()


@pytest.mark.anyio
async def test_viewer_is_denied_for_every_privileged_route(app):
    _add_viewer(app)
    routes = [
        ("POST", "/api/devices", {"name": "x", "device_type": "desktop", "supports_wol": False}),
        ("PATCH", "/api/devices/1", {"name": "x"}),
        ("DELETE", "/api/devices/1", None),
        ("PATCH", "/api/services/adguard-home/ports", {"ports": {"dns": 5353}}),
        ("POST", "/api/services/adguard-home/ports/apply", None),
        ("POST", "/api/services/adguard-home/actions/start", None),
        ("POST", "/api/tailscale/settings", {"tailnet": "example.com"}),
        ("POST", "/api/tailscale/test", None),
        ("POST", "/api/tailscale/sync", None),
        ("PATCH", "/api/tailscale/devices/1/wol", {"supports_wol": False}),
        ("PATCH", "/api/tailscale/devices/1/settings", {"supports_wol": False}),
        ("POST", "/api/tailscale/devices/1/wake", None),
        ("POST", "/api/wol/wake", {"device_id": 1}),
        ("PATCH", "/api/admin/users/1", {"is_admin": False}),
    ]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client, "viewer", "Viewer-password-123!")
        for method, path, body in routes:
            response = await client.request(method, path, json=body)
            assert response.status_code == 403, (method, path, response.text)


@pytest.mark.anyio
async def test_recent_authentication_and_session_rotation(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        old_cookie = client.cookies[get_settings().cookie_name]
        db = app.state.testing_session_local()
        try:
            session = db.query(SessionToken).filter(SessionToken.revoked_at.is_(None)).one()
            session.authentication_time = utc_now() - timedelta(hours=1)
            db.commit()
        finally:
            db.close()

        denied = await client.post("/api/services/adguard-home/actions/start")
        assert denied.status_code == 403
        reauth = await client.post("/api/auth/reauthenticate", json={"password": "Test-secret-123!"})
        assert reauth.status_code == 200
        assert client.cookies[get_settings().cookie_name] != old_cookie
        with patch(
            "app.services.docker_service.request_service_action", return_value={"ok": True}
        ):
            allowed = await client.post("/api/services/adguard-home/actions/start")
        assert allowed.status_code == 200

    db = app.state.testing_session_local()
    try:
        rows = db.query(SessionToken).order_by(SessionToken.id).all()
        assert rows[0].revoked_at is not None
        assert rows[-1].revoked_at is None
    finally:
        db.close()


@pytest.mark.anyio
async def test_logout_all_revokes_every_session(app):
    first = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    second = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    try:
        await _login(first)
        await _login(second)
        response = await first.post("/api/auth/logout-all")
        assert response.status_code == 200
        assert response.json()["revoked"] == 2
        assert (await second.get("/api/auth/me")).status_code == 401
    finally:
        await first.aclose()
        await second.aclose()


@pytest.mark.anyio
async def test_account_disablement_revokes_existing_sessions(app):
    viewer_user = _add_viewer(app)
    viewer = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    admin = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    try:
        await _login(viewer, "viewer", "Viewer-password-123!")
        await _login(admin)
        changed = await admin.patch(f"/api/admin/users/{viewer_user.id}", json={"is_active": False})
        assert changed.status_code == 200
        assert (await viewer.get("/api/auth/me")).status_code == 401
    finally:
        await viewer.aclose()
        await admin.aclose()


@pytest.mark.anyio
async def test_login_rate_limit_is_generic_and_temporary(app, monkeypatch):
    monkeypatch.setenv("PIHOMEHUB_LOGIN_RATE_LIMIT_ATTEMPTS", "3")
    get_settings.cache_clear()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        for username in ("unknown", "unknown", "unknown"):
            failure = await client.post("/api/auth/login", json={"username": username, "password": "bad"})
            assert failure.status_code == 401
            assert failure.json()["detail"] == "Invalid credentials"
        limited = await client.post("/api/auth/login", json={"username": "unknown", "password": "bad"})
        assert limited.status_code == 429
        assert limited.json()["detail"] == "Invalid credentials"


@pytest.mark.anyio
async def test_audit_events_are_sanitized_and_admin_only(app):
    _add_viewer(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as admin:
        await _login(admin)
        events = await admin.get("/api/admin/audit-events")
        assert events.status_code == 200
        assert any(row["event"] == "login_success" for row in events.json())
        assert "Test-secret-123!" not in events.text
        assert "X-CSRF-Token" not in events.text
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as viewer:
        await _login(viewer, "viewer", "Viewer-password-123!")
        assert (await viewer.get("/api/admin/audit-events")).status_code == 403


@pytest.mark.anyio
async def test_control_agent_errors_do_not_leak_secrets_to_response_or_logs(app, caplog):
    from app.services.control_agent_client import ControlAgentError

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        with patch(
            "app.services.docker_service.request_service_action",
            side_effect=ControlAgentError("registry_password=super-secret-value"),
        ):
            response = await client.post("/api/services/adguard-home/actions/start")
    assert response.status_code == 502
    assert "super-secret-value" not in response.text
    assert "super-secret-value" not in caplog.text


def test_production_configuration_fails_closed_and_cookie_name_is_host_prefixed():
    with pytest.raises(ValueError):
        Settings(env="production", secret_key="change-me", control_agent_secret="change-me", public_base_url="http://pi")
    settings = Settings(
        env="production",
        secret_key="s" * 40,
        control_agent_secret="c" * 40,
        public_base_url="https://pi.example",
        allowed_origins="https://pi.example",
        admin_password="",
    )
    assert settings.cookie_name == "__Host-pihomehub_session"
    assert settings.cookie_secure is True


def test_production_cookie_is_secure(monkeypatch):
    from fastapi import Response
    from app.api.auth import _set_session_cookie

    monkeypatch.setenv("PIHOMEHUB_ENV", "production")
    monkeypatch.setenv("PIHOMEHUB_SECRET_KEY", "s" * 40)
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_SECRET", "c" * 40)
    monkeypatch.setenv("PIHOMEHUB_PUBLIC_BASE_URL", "https://pi.example")
    monkeypatch.setenv("PIHOMEHUB_ALLOWED_ORIGINS", "https://pi.example")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_PASSWORD", "")
    get_settings.cache_clear()
    response = Response()
    _set_session_cookie(response, "raw-session", "raw-csrf")
    cookies = response.headers.getlist("set-cookie")
    session_cookie = next(cookie for cookie in cookies if "__Host-pihomehub_session=" in cookie)
    assert "Secure" in session_cookie
    assert "HttpOnly" in session_cookie
    assert "SameSite=strict" in session_cookie
    assert "Domain=" not in session_cookie
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_production_docs_are_disabled_and_hsts_is_enabled(monkeypatch):
    from app.main import create_app

    monkeypatch.setenv("PIHOMEHUB_ENV", "production")
    monkeypatch.setenv("PIHOMEHUB_SECRET_KEY", "s" * 40)
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_SECRET", "c" * 40)
    monkeypatch.setenv("PIHOMEHUB_PUBLIC_BASE_URL", "https://pi.example")
    monkeypatch.setenv("PIHOMEHUB_ALLOWED_ORIGINS", "https://pi.example")
    monkeypatch.setenv("PIHOMEHUB_ADMIN_PASSWORD", "")
    get_settings.cache_clear()
    production_app = create_app(include_lifespan=False)
    async with RawAsyncClient(transport=ASGITransport(app=production_app), base_url="https://pi.example") as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 404
        health = await client.get("/health")
    assert health.headers["Strict-Transport-Security"].startswith("max-age=31536000")
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_real_app_security_headers_are_present(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert response.headers["Referrer-Policy"] == "no-referrer"
