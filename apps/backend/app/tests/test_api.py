from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

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
