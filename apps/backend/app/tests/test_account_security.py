from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

import pytest
from fastapi import Request
from httpx import ASGITransport

from app.core.security import find_session, hash_password, hash_token, verify_password, utc_now
from app.models.user import AuditEvent, SessionToken, User
from app.services.account_security_service import (
    AccountSecurityError,
    update_user_security_atomically,
)
from app.tests.conftest import AsyncClient
from app.tests.test_security_phase1 import _add_viewer, _login


def _request():
    request = Request({
        "type": "http", "method": "PATCH", "path": "/api/admin/users/2",
        "raw_path": b"/api/admin/users/2", "query_string": b"", "headers": [],
        "scheme": "http", "server": ("testserver", 80), "client": ("127.0.0.1", 1000),
        "http_version": "1.1", "asgi": {"version": "3.0", "spec_version": "2.3"},
    })
    request.state.request_id = "account-security-test"
    request.state.source_ip = "127.0.0.1"
    return request


@pytest.mark.anyio
async def test_admin_user_list_is_minimal_and_admin_only(app):
    viewer_user = _add_viewer(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as anonymous:
        assert (await anonymous.get("/api/admin/users")).status_code == 401
        assert (await anonymous.get("/api/admin/audit-events/page")).status_code == 401
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as admin:
        await _login(admin)
        response = await admin.get("/api/admin/users")
        assert response.status_code == 200
        rows = response.json()
        assert [row["username"] for row in rows] == ["admin", "viewer"]
        assert set(rows[0]) == {"id", "username", "is_admin", "is_active"}
        assert rows[1]["id"] == viewer_user.id
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as viewer:
        await _login(viewer, "viewer", "Viewer-password-123!")
        assert (await viewer.get("/api/admin/users")).status_code == 403
        assert (await viewer.get("/api/admin/audit-events/page")).status_code == 403


@pytest.mark.anyio
async def test_account_and_session_timestamps_have_utc_offsets(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login = await _login(client)
        assert login.json()["password_changed_at"].endswith(("Z", "+00:00"))
        response = await client.get("/api/auth/sessions")
        assert response.status_code == 200
        for field in ("created_at", "last_seen_at", "expires_at", "authentication_time"):
            assert response.json()[0][field].endswith(("Z", "+00:00"))


@pytest.mark.anyio
async def test_audit_summary_filters_and_pagination_exclude_raw_metadata(app):
    db = app.state.testing_session_local()
    try:
        admin = db.query(User).filter(User.username == "admin").one()
        timestamp = utc_now()
        db.add_all([
            AuditEvent(created_at=timestamp, actor_user_id=admin.id, event="login_success", success=True, metadata_json=json.dumps({"password": "private-value"})),
            AuditEvent(created_at=timestamp, actor_user_id=admin.id, event="service_restart", target_type="service", target_identifier="gitea", success=True, metadata_json="{}"),
            AuditEvent(created_at=timestamp, actor_user_id=None, event="device_delete", target_type="device", target_identifier="2", success=False, metadata_json="{}"),
        ])
        db.commit()
    finally:
        db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        first = await client.get("/api/admin/audit-events/page?limit=2&category=all")
        assert first.status_code == 200
        first_data = first.json()
        assert len(first_data["items"]) == 2
        assert first_data["next_cursor"] is not None
        assert "metadata_json" not in first.text
        assert "private-value" not in first.text
        assert first_data["items"][0]["actor_username"] == "admin"
        second = await client.get(f"/api/admin/audit-events/page?limit=2&before_id={first_data['next_cursor']}&category=all")
        assert second.status_code == 200
        assert not ({row["id"] for row in first_data["items"]} & {row["id"] for row in second.json()["items"]})
        assert all(row["id"] < first_data["next_cursor"] for row in second.json()["items"])
        service_events = await client.get("/api/admin/audit-events/page?category=services")
        assert [event["event"] for event in service_events.json()["items"]] == ["service_restart"]
        auth_events = await client.get("/api/admin/audit-events/page?category=authentication")
        assert auth_events.json()["items"]
        assert all(event["event"] == "login_success" for event in auth_events.json()["items"])


@pytest.mark.anyio
async def test_password_change_is_atomic_and_revokes_all_sessions(app):
    second = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    primary = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    try:
        await _login(primary)
        await _login(second)
        response = await primary.post("/api/auth/change-password", json={
            "current_password": "Test-secret-123!",
            "new_password": "A-new-secret-123!",
        })
        assert response.status_code == 200, response.text
        assert get_cookie(primary, "pihomehub_session") is None
        assert (await second.get("/api/auth/me")).status_code == 401
    finally:
        await primary.aclose()
        await second.aclose()

    db = app.state.testing_session_local()
    try:
        user = db.query(User).filter(User.username == "admin").one()
        assert verify_password("A-new-secret-123!", user.password_hash)
        rows = db.query(SessionToken).filter(SessionToken.user_id == user.id).all()
        assert rows and all(row.revoked_at is not None for row in rows)
        event = db.query(AuditEvent).filter(AuditEvent.event == "password_change", AuditEvent.success.is_(True)).one()
        assert "A-new-secret-123!" not in event.metadata_json
    finally:
        db.close()


def get_cookie(client: AsyncClient, name: str):
    for cookie_name, value in client.cookies.items():
        if cookie_name.endswith(name):
            return value
    return None


@pytest.mark.anyio
async def test_password_failure_preserves_session_and_validation_never_echoes_input(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        wrong = await client.post("/api/auth/change-password", json={
            "current_password": "wrong-current-password",
            "new_password": "A-new-secret-123!",
        })
        assert wrong.status_code == 401
        assert (await client.get("/api/auth/me")).status_code == 200
        marker = "NEVER-ECHO"
        invalid = await client.post("/api/auth/change-password", json={
            "current_password": "Test-secret-123!",
            "new_password": marker,
        })
        assert invalid.status_code == 422
        assert marker not in invalid.text


@pytest.mark.anyio
async def test_user_patch_returns_enabled_state_and_preserves_self_protection(app):
    viewer = _add_viewer(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client, AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as viewer_client:
        await _login(client)
        await _login(viewer_client, "viewer", "Viewer-password-123!")
        unchanged = await client.patch(f"/api/admin/users/{viewer.id}", json={"is_admin": False})
        assert unchanged.status_code == 200
        assert (await viewer_client.get("/api/auth/me")).status_code == 200
        promoted = await client.patch(f"/api/admin/users/{viewer.id}", json={"is_admin": True})
        assert promoted.status_code == 200
        assert promoted.json()["is_active"] is True
        assert (await viewer_client.get("/api/auth/me")).status_code == 401
        self_demote = await client.patch("/api/admin/users/1", json={"is_admin": False})
        assert self_demote.status_code == 409
        self_disable = await client.patch("/api/admin/users/1", json={"is_active": False})
        assert self_disable.status_code == 409
        unsupported = await client.patch(f"/api/admin/users/{viewer.id}", json={"password_hash": "secret"})
        assert unsupported.status_code == 422
        assert "secret" not in unsupported.text


@pytest.mark.anyio
async def test_password_audit_failure_rolls_back_hash_timestamp_and_session_revocation(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        raw_cookie = get_cookie(client, "pihomehub_session")
        db = app.state.testing_session_local()
        try:
            session = find_session(db, raw_cookie)
            user = db.query(User).filter(User.username == "admin").one()
            assert session is not None
            before = user.password_changed_at
            with patch("app.services.account_security_service.record_audit_event", side_effect=RuntimeError("audit unavailable")):
                with pytest.raises(RuntimeError):
                    from app.services.account_security_service import change_password_atomically
                    change_password_atomically(
                        db,
                        actor_user_id=user.id,
                        current_session_id=session.id,
                        current_password="Test-secret-123!",
                        new_password="A-new-secret-123!",
                        request=_request(),
                    )
        finally:
            db.close()
        assert (await client.get("/api/auth/me")).status_code == 200

    verify = app.state.testing_session_local()
    try:
        user = verify.query(User).filter(User.username == "admin").one()
        assert verify_password("Test-secret-123!", user.password_hash)
        assert user.password_changed_at == before
        assert verify.query(SessionToken).filter(SessionToken.user_id == user.id, SessionToken.revoked_at.is_(None)).count() == 1
    finally:
        verify.close()


@pytest.mark.anyio
async def test_concurrent_admin_demotion_cannot_leave_zero_active_admins(app):
    second_admin = User(
        username="second-admin", password_hash=hash_password("Second-admin-password-123!"),
        is_admin=True, is_active=True,
    )
    db = app.state.testing_session_local()
    try:
        db.add(second_admin); db.commit(); db.refresh(second_admin)
        second_id = second_admin.id
    finally:
        db.close()

    first = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    second = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    try:
        await _login(first)
        await _login(second, "second-admin", "Second-admin-password-123!")
        factory = app.state.testing_session_local
        barrier = Barrier(2)

        def update(actor_id: int, target_id: int, raw_cookie: str):
            barrier.wait(timeout=5)
            request = _request()
            local = factory()
            try:
                active_session = find_session(local, raw_cookie)
                assert active_session is not None
                try:
                    update_user_security_atomically(
                        local, actor_user_id=actor_id, current_session_id=active_session.id,
                        user_id=target_id, changes={"is_admin": False}, request=request,
                    )
                    return "updated"
                except AccountSecurityError as exc:
                    return exc.status_code
            finally:
                local.close()

        one = factory()
        try:
            first_user = one.query(User).filter(User.username == "admin").one()
            other_user = one.query(User).filter(User.username == "second-admin").one()
            first_id, other_id = first_user.id, other_user.id
        finally:
            one.close()
        first_cookie = get_cookie(first, "pihomehub_session")
        second_cookie = get_cookie(second, "pihomehub_session")
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = await asyncio.gather(
                loop.run_in_executor(pool, update, first_id, other_id, first_cookie),
                loop.run_in_executor(pool, update, other_id, first_id, second_cookie),
            )
        assert outcomes.count("updated") == 1
        check = factory()
        try:
            assert check.query(User).filter(User.is_admin.is_(True), User.is_active.is_(True)).count() >= 1
        finally:
            check.close()
    finally:
        await first.aclose()
        await second.aclose()


@pytest.mark.anyio
async def test_failed_admin_audit_rolls_back_role_change_and_session_revocation(app):
    viewer = _add_viewer(app)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await _login(client)
        raw_cookie = get_cookie(client, "pihomehub_session")
        db = app.state.testing_session_local()
        try:
            session = find_session(db, raw_cookie)
            assert session is not None
            with patch("app.services.account_security_service.record_audit_event", side_effect=RuntimeError("audit unavailable")):
                with pytest.raises(RuntimeError):
                    update_user_security_atomically(
                        db, actor_user_id=session.user_id, current_session_id=session.id,
                        user_id=viewer.id, changes={"is_admin": True}, request=_request(),
                    )
        finally:
            db.close()
    check = app.state.testing_session_local()
    try:
        target = check.query(User).filter(User.id == viewer.id).one()
        assert target.is_admin is False
        sessions = check.query(SessionToken).filter(SessionToken.user_id == viewer.id).all()
        assert sessions == []
    finally:
        check.close()
