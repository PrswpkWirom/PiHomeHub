from unittest.mock import AsyncMock, patch
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.models.tailscale_device import TailscaleDevice
from app.models.user import AppSetting

@pytest.mark.anyio
async def test_login_and_me(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert response.status_code == 200
        assert response.json()["username"] == "admin"

        me = await client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["is_admin"] is True


@pytest.mark.anyio
async def test_protected_route_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.get("/api/system/pi")
        assert response.status_code == 401


@pytest.mark.anyio
async def test_pi_status_schema(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert response.status_code == 200

        response = await client.get("/api/system/pi")
        assert response.status_code == 200
        payload = response.json()
        assert "cpu_percent" in payload
        assert "memory_percent" in payload
        assert "disk_percent" in payload


@pytest.mark.anyio
async def test_task_crud(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200

        created = await client.post("/api/tasks", json={"title": "Test task", "due_label": "Today"})
        assert created.status_code == 201
        task_id = created.json()["id"]

        listing = await client.get("/api/tasks")
        assert any(task["id"] == task_id for task in listing.json())

        updated = await client.patch(f"/api/tasks/{task_id}", json={"is_complete": True})
        assert updated.status_code == 200
        assert updated.json()["is_complete"] is True

        deleted = await client.delete(f"/api/tasks/{task_id}")
        assert deleted.status_code == 204


@pytest.mark.anyio
async def test_service_status_missing_container(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200

        with patch("app.services.docker_service.subprocess.run") as mocked_run:
            mocked_run.return_value.stdout = ""
            mocked_run.return_value.returncode = 0
            response = await client.get("/api/services/status")
        assert response.status_code == 200
        assert response.json()[0]["status"] == "missing"


@pytest.mark.anyio
async def test_wol_requires_supported_device(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200

        with patch("app.services.wol_service._send_magic_packet") as sender:
            response = await client.post("/api/wol/wake", json={"device_id": 1})
            assert response.status_code == 200
            sender.assert_called_once()

        unsupported = await client.post("/api/wol/wake", json={"device_id": 999})
        assert unsupported.status_code == 404


@pytest.mark.anyio
async def test_tailscale_settings_hide_and_protect_token(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200

        saved = await client.post("/api/tailscale/settings", json={"api_token": "tskey-secret", "tailnet": "example.com"})
        assert saved.status_code == 200
        assert "tskey-secret" not in saved.text

        status_response = await client.get("/api/tailscale/status")
        assert status_response.status_code == 200
        assert status_response.json()["token_saved"] is True
        assert "tskey-secret" not in status_response.text

    db = app.state.testing_session_local()
    try:
        token_setting = db.query(AppSetting).filter(AppSetting.key == "tailscale_api_token").one()
        assert token_setting.value != "tskey-secret"
        assert "tskey-secret" not in token_setting.value
    finally:
        db.close()


@pytest.mark.anyio
async def test_tailscale_test_connection_success_and_failure(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200
        await client.post("/api/tailscale/settings", json={"api_token": "tskey-secret", "tailnet": "example.com"})

        with patch("app.services.tailscale_service._fetch_devices", new=AsyncMock(return_value=[])):
            response = await client.post("/api/tailscale/test")
        assert response.status_code == 200
        assert response.json()["ok"] is True

        with patch("app.services.tailscale_service._fetch_devices", new=AsyncMock(side_effect=Exception("network down"))):
            failed = await client.post("/api/tailscale/test")
        assert failed.status_code == 200
        assert failed.json()["ok"] is False


@pytest.mark.anyio
async def test_tailscale_sync_upsert_missing_and_manual_device_isolation(app):
    first_payload = [
        {
            "id": "device-1",
            "nodeId": "node-1",
            "name": "desktop.tailnet.ts.net",
            "hostname": "desktop",
            "addresses": ["100.64.0.10", "fd7a:115c:a1e0::10"],
            "os": "windows",
            "online": True,
            "lastSeen": "2026-01-30T12:00:00Z",
            "tags": ["tag:workstation"],
        }
    ]
    second_payload = [
        {
            "id": "device-2",
            "nodeId": "node-2",
            "name": "laptop.tailnet.ts.net",
            "hostname": "laptop",
            "addresses": ["100.64.0.11"],
            "os": "linux",
            "online": False,
            "lastSeen": "2026-01-31T12:00:00Z",
            "tags": [],
        }
    ]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200
        manual = await client.post(
            "/api/devices",
            json={"name": "Manual NAS", "device_type": "nas", "ip_address": "192.168.1.20"},
        )
        assert manual.status_code == 201
        await client.post("/api/tailscale/settings", json={"api_token": "tskey-secret", "tailnet": "example.com"})

        with patch("app.services.tailscale_service._fetch_devices", new=AsyncMock(return_value=first_payload)):
            synced = await client.post("/api/tailscale/sync")
        assert synced.status_code == 200
        assert synced.json()[0]["tailscale_id"] == "device-1"

        with patch("app.services.tailscale_service._fetch_devices", new=AsyncMock(return_value=second_payload)):
            synced_again = await client.post("/api/tailscale/sync")
        assert synced_again.status_code == 200

        tailscale_devices = await client.get("/api/tailscale/devices")
        statuses = {device["tailscale_id"]: device["sync_status"] for device in tailscale_devices.json()}
        assert statuses["device-1"] == "missing_from_tailnet"
        assert statuses["device-2"] == "active"

        manual_devices = await client.get("/api/devices")
        assert any(device["name"] == "Manual NAS" for device in manual_devices.json())


@pytest.mark.anyio
async def test_tailscale_sync_infers_online_from_recent_last_seen(app):
    recent_last_seen = (datetime.now(UTC) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
    old_last_seen = "2026-05-02T14:05:10Z"
    payload = [
        {
            "id": "device-recent",
            "name": "connected.tailnet.ts.net",
            "hostname": "connected",
            "addresses": ["100.80.65.88"],
            "os": "linux",
            "lastSeen": recent_last_seen,
            "tags": [],
        },
        {
            "id": "device-old",
            "name": "offline.tailnet.ts.net",
            "hostname": "offline",
            "addresses": ["100.111.160.104"],
            "os": "macOS",
            "lastSeen": old_last_seen,
            "tags": [],
        },
    ]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200
        await client.post("/api/tailscale/settings", json={"api_token": "tskey-secret", "tailnet": "example.com"})

        with patch("app.services.tailscale_service._fetch_devices", new=AsyncMock(return_value=payload)):
            response = await client.post("/api/tailscale/sync")

        assert response.status_code == 200
        statuses = {device["tailscale_id"]: device["online"] for device in response.json()}
        assert statuses["device-recent"] is True
        assert statuses["device-old"] is False


@pytest.mark.anyio
async def test_tailscale_sync_prefers_connected_to_control(app):
    payload = [
        {
            "id": "device-connected",
            "name": "desktop.tailnet.ts.net",
            "hostname": "desktop",
            "addresses": ["100.80.65.88"],
            "os": "linux",
            "connectedToControl": True,
            "lastSeen": "2026-01-30T12:00:00Z",
            "tags": [],
        },
        {
            "id": "device-disconnected",
            "name": "vivobook.tailnet.ts.net",
            "hostname": "vivobook",
            "addresses": ["100.65.234.44"],
            "os": "linux",
            "connectedToControl": False,
            "lastSeen": (datetime.now(UTC) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            "tags": [],
        },
    ]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200
        await client.post("/api/tailscale/settings", json={"api_token": "tskey-secret", "tailnet": "example.com"})

        with patch("app.services.tailscale_service._fetch_devices", new=AsyncMock(return_value=payload)):
            response = await client.post("/api/tailscale/sync")

        assert response.status_code == 200
        statuses = {device["tailscale_id"]: device["online"] for device in response.json()}
        assert statuses["device-connected"] is True
        assert statuses["device-disconnected"] is False


@pytest.mark.anyio
async def test_tailscale_wol_validation_and_wake(app):
    db = app.state.testing_session_local()
    try:
        db.add(TailscaleDevice(tailscale_id="device-1", machine_name="desktop", tailscale_ips="[]", tags="[]"))
        db.commit()
    finally:
        db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "test-secret"})
        assert login_response.status_code == 200

        blocked = await client.post("/api/tailscale/devices/1/wake")
        assert blocked.status_code == 400

        invalid_config = await client.patch("/api/tailscale/devices/1/wol", json={"supports_wol": True})
        assert invalid_config.status_code == 422

        configured = await client.patch(
            "/api/tailscale/devices/1/wol",
            json={
                "supports_wol": True,
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "lan_ip_address": "192.168.1.50",
                "broadcast_address": "192.168.1.255",
                "alias": "Gaming Desktop",
                "note": "Wake over LAN",
            },
        )
        assert configured.status_code == 200
        assert configured.json()["machine_name"] == "Gaming Desktop"

        with patch("app.services.tailscale_service._send_magic_packet") as sender:
            wake = await client.post("/api/tailscale/devices/1/wake")
            assert wake.status_code == 200
            sender.assert_called_once_with("AA:BB:CC:DD:EE:FF", "192.168.1.255")
