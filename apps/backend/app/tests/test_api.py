import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport

from app.tests.conftest import AsyncClient

from app.models.tailscale_device import TailscaleDevice
from app.models.user import AppSetting


def _services_snapshot(status="missing", port_bindings=None):
    port_bindings = port_bindings or {}
    slugs = ("adguard-home", "gitea", "mosquitto", "uptime-kuma", "vaultwarden")
    return [{"slug": slug, "status": status, "detail": "Container not installed" if status == "missing" else status.title(),
             "health_status": None, "ports": port_bindings.get(slug, []), "started_at": None,
             "host_ip": "100.64.1.2", "host_ports": {}, "url": None,
             "setup_required": slug == "mosquitto", "operation": None} for slug in slugs]


def _service_operation(slug="adguard-home", action="restart", operation_id="operation-service-0001"):
    now = datetime.now(UTC).isoformat()
    return {"operation_id": operation_id, "slug": slug, "action": action, "state": "queued", "stage": "queued",
            "created_at": now, "updated_at": now, "finished_at": None, "error_code": None,
            "message": None, "actor_user_id": 1}


@pytest.mark.anyio
async def test_backend_health_reports_database_failure_without_details(app):
    from sqlalchemy.exc import OperationalError
    from app.database.db import get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        assert (await client.get("/health")).json() == {"status": "ok"}
        original = app.dependency_overrides[get_db]
        async def unavailable_database():
            from unittest.mock import Mock
            db = Mock()
            db.execute.side_effect = OperationalError("private sql", {}, RuntimeError("private error"))
            yield db
        app.dependency_overrides[get_db] = unavailable_database
        try:
            response = await client.get("/health")
            assert response.status_code == 503
            assert response.json() == {"status": "unavailable"}
        finally:
            app.dependency_overrides[get_db] = original


@pytest.mark.anyio
async def test_login_and_me(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
async def test_manual_devices_excludes_synthetic_self_host(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        listing = await client.get("/api/devices")

    assert listing.status_code == 200
    devices = listing.json()
    assert all(device["id"] is not None for device in devices)
    assert all(device["description"] != "Local PiHomeHub host" for device in devices)
    assert [device["name"] for device in devices] == ["Gaming Desktop"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status_probe_error",
    [
        FileNotFoundError("ping"),
        subprocess.TimeoutExpired(cmd=["ping"], timeout=3),
        OSError("status probe failed"),
    ],
)
async def test_manual_devices_status_probe_failures_do_not_break_listing(app, status_probe_error):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with patch("app.services.device_service.subprocess.run", side_effect=status_probe_error):
            listing = await client.get("/api/devices")

    assert listing.status_code == 200
    devices = listing.json()
    assert [device["name"] for device in devices] == ["Gaming Desktop"]
    assert devices[0]["status"] == "unknown"


@pytest.mark.anyio
async def test_manual_devices_empty_without_seeded_or_added_devices(app_without_known_devices):
    async with AsyncClient(transport=ASGITransport(app=app_without_known_devices), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        listing = await client.get("/api/devices")

    assert listing.status_code == 200
    assert listing.json() == []


@pytest.mark.anyio
async def test_deleted_seeded_manual_device_does_not_reappear(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        listing = await client.get("/api/devices")
        seeded = next(device for device in listing.json() if device["name"] == "Gaming Desktop")
        deleted = await client.delete(f"/api/devices/{seeded['id']}")
        assert deleted.status_code == 204

    from app.database.bootstrap import seed_defaults

    db = app.state.testing_session_local()
    try:
        seed_defaults(db)
    finally:
        db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200
        listing = await client.get("/api/devices")
        assert all(device["name"] != "Gaming Desktop" for device in listing.json())


@pytest.mark.anyio
async def test_renamed_seeded_manual_device_does_not_duplicate_original_seed(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        listing = await client.get("/api/devices")
        seeded = next(device for device in listing.json() if device["name"] == "Gaming Desktop")
        renamed = await client.patch(
            f"/api/devices/{seeded['id']}",
            json={
                "name": "Main Workstation",
                "device_type": seeded["device_type"],
                "ip_address": seeded["ip_address"],
                "tailscale_name": seeded["tailscale_name"],
                "mac_address": seeded["mac_address"],
                "supports_wol": seeded["supports_wol"],
                "description": seeded["description"],
            },
        )
        assert renamed.status_code == 200

    from app.database.bootstrap import seed_defaults

    db = app.state.testing_session_local()
    try:
        seed_defaults(db)
    finally:
        db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200
        listing = await client.get("/api/devices")
        names = [device["name"] for device in listing.json()]
        assert "Main Workstation" in names
        assert "Gaming Desktop" not in names


@pytest.mark.anyio
async def test_duplicate_manual_device_name_returns_conflict(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        response = await client.post(
            "/api/devices",
            json={
                "name": "Gaming Desktop",
                "device_type": "desktop",
                "supports_wol": False,
            },
        )

    assert response.status_code == 409
    assert "already exists" in response.text


@pytest.mark.anyio
async def test_renaming_manual_device_to_existing_name_returns_conflict(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        created = await client.post(
            "/api/devices",
            json={
                "name": "Spare Desktop",
                "device_type": "desktop",
                "supports_wol": False,
            },
        )
        assert created.status_code == 201

        response = await client.patch(
            f"/api/devices/{created.json()['id']}",
            json={
                "name": "Gaming Desktop",
                "device_type": "desktop",
                "supports_wol": False,
            },
        )

    assert response.status_code == 409
    assert "already exists" in response.text


@pytest.mark.anyio
async def test_service_status_missing_container(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with patch("app.services.docker_service.get_service_snapshot", return_value=_services_snapshot()):
            response = await client.get("/api/services/status")
        assert response.status_code == 200
        assert response.json()[0]["status"] == "missing"


@pytest.mark.anyio
async def test_service_action_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/api/services/adguard-home/actions/start")
        assert response.status_code == 401


@pytest.mark.anyio
async def test_service_action_rejects_unknown_service_and_action(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        payload = {"operation_id": "operation-unknown-service-0001"}
        unknown_service = await client.post("/api/services/backend/actions/stop", json=payload)
        assert unknown_service.status_code == 404

        unknown_action = await client.post("/api/services/adguard-home/actions/down", json=payload)
        assert unknown_action.status_code == 404


@pytest.mark.anyio
async def test_service_capabilities_include_all_optional_services(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with patch("app.services.docker_service.get_service_snapshot", return_value=_services_snapshot()):
            response = await client.get("/api/services/capabilities")

    assert response.status_code == 200
    capabilities = {item["slug"]: item["actions"] for item in response.json()}
    assert set(capabilities) == {"adguard-home", "gitea", "mosquitto", "uptime-kuma", "vaultwarden"}
    assert all(actions == ["create", "start", "stop", "restart"] for actions in capabilities.values())


@pytest.mark.anyio
async def test_service_ports_return_defaults(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with (
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot()),
        ):
            response = await client.get("/api/services/ports")

    assert response.status_code == 200
    adguard = next(item for item in response.json() if item["slug"] == "adguard-home")
    dns = next(port for port in adguard["ports"] if port["key"] == "dns")
    assert dns["desired_host_port"] == 53
    assert dns["protocols"] == ["tcp", "udp"]
    assert adguard["has_pending_port_change"] is False


@pytest.mark.anyio
async def test_service_port_update_writes_env_and_marks_running_service_pending(app):
    from app.core.config import get_settings

    running_adguard = {
        (3000, "tcp"): 3001,
        (53, "tcp"): 53,
        (53, "udp"): 53,
    }

    def running_ports(slug: str):
        return running_adguard if slug == "adguard-home" else {}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with (
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot("running", {"adguard-home": [
                {"container_port": port, "protocol": protocol, "host_port": host_port}
                for (port, protocol), host_port in running_adguard.items()
            ]})),
            patch("app.services.service_ports._docker_running_ports", side_effect=running_ports),
            patch("app.services.service_ports._host_listeners", return_value={"tcp": set(), "udp": set()}),
        ):
            response = await client.patch("/api/services/adguard-home/ports", json={"ports": {"dns": 5353}})

    assert response.status_code == 200
    dns = next(port for port in response.json()["ports"] if port["key"] == "dns")
    assert dns["desired_host_port"] == 5353
    assert dns["running_host_ports"] == {"tcp": 53, "udp": 53}
    assert dns["pending"] is True
    assert response.json()["has_pending_port_change"] is True
    env_path = Path(get_settings().compose_env_file)
    assert "ADGUARD_DNS_PORT=5353" in env_path.read_text()


@pytest.mark.anyio
async def test_service_port_update_rejects_other_managed_service_running_port(app):
    def running_ports(slug: str):
        if slug == "adguard-home":
            return {(53, "tcp"): 53, (53, "udp"): 53}
        return {}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with (
            patch("app.services.service_ports._docker_running_ports", side_effect=running_ports),
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot()),
            patch("app.services.service_ports._host_listeners", return_value={"tcp": {53}, "udp": {53}}),
        ):
            response = await client.patch("/api/services/mosquitto/ports", json={"ports": {"mqtt": 53}})

    assert response.status_code == 409
    assert "adguard-home" in response.text


@pytest.mark.anyio
async def test_service_port_update_rejects_duplicate_desired_managed_port(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with (
            patch("app.services.service_ports._docker_running_ports", return_value={}),
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot()),
            patch("app.services.service_ports._host_listeners", return_value={"tcp": set(), "udp": set()}),
        ):
            response = await client.patch("/api/services/vaultwarden/ports", json={"ports": {"http": 3001}})

    assert response.status_code == 409
    assert "adguard-home" in response.text


@pytest.mark.anyio
async def test_service_port_update_rejects_non_pihomehub_host_listener(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with (
            patch("app.services.service_ports._docker_running_ports", return_value={}),
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot()),
            patch("app.services.service_ports._host_listeners", return_value={"tcp": {3007}, "udp": set()}),
        ):
            response = await client.patch("/api/services/vaultwarden/ports", json={"ports": {"http": 3007}})

    assert response.status_code == 409
    assert "already in use on this host" in response.text


@pytest.mark.anyio
async def test_service_port_update_rejects_stringified_port(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        response = await client.patch("/api/services/adguard-home/ports", json={"ports": {"dns": "5353"}})

    assert response.status_code == 422


@pytest.mark.anyio
async def test_service_port_update_allows_same_service_current_port(app):
    def running_ports(slug: str):
        if slug == "adguard-home":
            return {(53, "tcp"): 53, (53, "udp"): 53}
        return {}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        with (
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot("running", {"adguard-home": [
                {"container_port": 53, "protocol": protocol, "host_port": host_port}
                for (port, protocol), host_port in running_ports("adguard-home").items()
            ]})),
            patch("app.services.service_ports._docker_running_ports", side_effect=running_ports),
            patch("app.services.service_ports._host_listeners", return_value={"tcp": {53}, "udp": {53}}),
        ):
            response = await client.patch("/api/services/adguard-home/ports", json={"ports": {"dns": 53}})

    assert response.status_code == 200
    dns = next(port for port in response.json()["ports"] if port["key"] == "dns")
    assert dns["pending"] is False


@pytest.mark.anyio
async def test_service_port_apply_requires_operator_redeployment(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        response = await client.post("/api/services/adguard-home/ports/apply")

        assert response.status_code == 404


@pytest.mark.anyio
async def test_service_port_config_exposes_only_fixed_operator_command(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"}
        )
        assert login_response.status_code == 200
        with patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot()):
            response = await client.get("/api/services/ports")

    assert response.status_code == 200
    for config in response.json():
        assert config["deployment_mode"] == "operator"
        assert config["configuration_mode"] == "web"
        assert config["bindings_verified"] is False
        assert config["operator_command"].endswith(config["slug"])
        assert config["slug"] in {"adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"}
        assert ";" not in config["operator_command"]


@pytest.mark.anyio
async def test_stopped_service_bindings_still_report_pending_or_applied(app):
    def old_bindings(slug: str):
        return {(3000, "tcp"): 3001, (53, "tcp"): 69, (53, "udp"): 69} if slug == "adguard-home" else {}

    def desired_bindings(slug: str):
        return {(3000, "tcp"): 3001, (53, "tcp"): 53, (53, "udp"): 53} if slug == "adguard-home" else {}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        with (
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot("exited", {"adguard-home": [
                {"container_port": port, "protocol": protocol, "host_port": host_port}
                for (port, protocol), host_port in old_bindings("adguard-home").items()
            ]})),
            patch("app.services.service_ports._docker_running_ports", side_effect=old_bindings),
        ):
            old = await client.get("/api/services/ports")
        with (
            patch("app.services.service_ports.docker_service.get_service_snapshot", return_value=_services_snapshot("exited", {"adguard-home": [
                {"container_port": port, "protocol": protocol, "host_port": host_port}
                for (port, protocol), host_port in desired_bindings("adguard-home").items()
            ]})),
            patch("app.services.service_ports._docker_running_ports", side_effect=desired_bindings),
        ):
            applied = await client.get("/api/services/ports")

    old_adguard = next(config for config in old.json() if config["slug"] == "adguard-home")
    applied_adguard = next(config for config in applied.json() if config["slug"] == "adguard-home")
    assert old_adguard["bindings_verified"] is True
    assert old_adguard["has_pending_port_change"] is True
    assert applied_adguard["bindings_verified"] is True
    assert applied_adguard["has_pending_port_change"] is False


def test_service_port_catalog_replaces_unreadable_compose_env_dependency(tmp_path, monkeypatch):
    import json
    from app.core.config import get_settings
    from app.services.service_ports import _desired_ports

    catalog = tmp_path / "services.json"
    catalog.write_text(json.dumps({"project": "infra", "services": [
        {"slug": "adguard-home", "ports": {"web": 3301, "dns": 5353}},
        {"slug": "gitea", "ports": {"http": 3302, "ssh": 2322}},
        {"slug": "uptime-kuma", "ports": {"http": 3303}},
        {"slug": "vaultwarden", "ports": {"http": 3304}},
        {"slug": "mosquitto", "ports": {"mqtt": 1884}},
    ]}))
    unreadable = tmp_path / "secret.env"
    unreadable.write_text("ADGUARD_DNS_PORT=53\n")
    unreadable.chmod(0)
    monkeypatch.setattr(get_settings(), "service_config_file", str(catalog))
    monkeypatch.setattr(get_settings(), "compose_env_file", str(unreadable))

    desired = _desired_ports()
    assert desired["adguard-home"] == {"web": 3301, "dns": 5353}
    assert desired["mosquitto"]["mqtt"] == 1884


def test_service_port_catalog_failure_is_reported_as_unavailable(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from app.core.config import get_settings
    from app.services.service_ports import _desired_ports

    monkeypatch.setattr(get_settings(), "service_config_file", str(tmp_path / "missing.json"))
    with pytest.raises(HTTPException) as error:
        _desired_ports()
    assert error.value.status_code == 503


def test_default_compose_paths_support_docker_container_layout(tmp_path):
    from app.services.docker_service import _default_compose_paths

    module_file = tmp_path / "app" / "app" / "services" / "docker_service.py"
    module_file.parent.mkdir(parents=True)
    module_file.write_text("")

    workspace = tmp_path / "workspace"
    infra = workspace / "infra"
    infra.mkdir(parents=True)
    compose_file = infra / "docker-compose.yml"
    compose_file.write_text("services: {}\n")

    resolved_compose_file, resolved_project_dir = _default_compose_paths(module_file, workspace)

    assert resolved_compose_file == compose_file.resolve()
    assert resolved_project_dir == infra.resolve()


@pytest.mark.anyio
async def test_service_action_returns_accepted_operation_and_preserves_idempotency_key(app):
    operation = _service_operation(action="restart")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200
        with patch("app.services.docker_service.request_service_action", return_value={"operation": operation}) as request:
            response = await client.post("/api/services/adguard-home/actions/restart", json={"operation_id": operation["operation_id"]})
    assert response.status_code == 202
    assert response.json()["operation"]["operation_id"] == operation["operation_id"]
    request.assert_called_once_with("adguard-home", "restart", operation["operation_id"], 1)


@pytest.mark.anyio
@pytest.mark.parametrize("slug", ["gitea", "uptime-kuma", "mosquitto"])
async def test_service_operation_request_supports_the_fixed_service_set(app, slug):
    operation = _service_operation(slug=slug, action="start", operation_id=f"operation-{slug}-0001")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        with patch("app.services.docker_service.request_service_action", return_value={"operation": operation}) as request:
            response = await client.post(f"/api/services/{slug}/actions/start", json={"operation_id": operation["operation_id"]})
    assert response.status_code == 202
    request.assert_called_once_with(slug, "start", operation["operation_id"], 1)


@pytest.mark.anyio
async def test_lost_control_agent_response_keeps_operation_outcome_recoverable(app):
    from app.services.control_agent_client import ControlAgentError
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        with patch("app.services.docker_service.request_service_action", side_effect=ControlAgentError("timeout")):
            response = await client.post("/api/services/adguard-home/actions/restart", json={"operation_id": "operation-lost-response-0001"})
    assert response.status_code == 503
    assert "refresh service status" in response.text.lower()


@pytest.mark.anyio
async def test_service_status_uses_typed_runtime_snapshot_and_returns_operation(app):
    operation = _service_operation(action="restart")
    snapshot = _services_snapshot("running")
    snapshot[0].update({"health_status": "healthy", "host_ip": "100.64.1.2", "url": "http://100.64.1.2:3001", "operation": operation})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        with patch("app.services.docker_service.get_service_snapshot", return_value=snapshot) as get_snapshot:
            response = await client.get("/api/services/status")
    assert response.status_code == 200
    adguard = next(item for item in response.json() if item["slug"] == "adguard-home")
    assert adguard["health_status"] == "healthy"
    assert adguard["operation"]["operation_id"] == operation["operation_id"]
    assert adguard["url"] == "http://100.64.1.2:3001"
    get_snapshot.assert_called_once()


@pytest.mark.anyio
async def test_wol_requires_supported_device(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
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
        assert configured.json()["machine_name"] == "desktop"
        assert configured.json()["display_name"] == "Gaming Desktop"

        with patch("app.services.tailscale_service._send_magic_packet") as sender:
            wake = await client.post("/api/tailscale/devices/1/wake")
            assert wake.status_code == 200
            sender.assert_called_once_with("AA:BB:CC:DD:EE:FF", "192.168.1.255")


@pytest.mark.anyio
async def test_tailscale_device_settings_display_name_and_wol(app):
    db = app.state.testing_session_local()
    try:
        db.add(TailscaleDevice(tailscale_id="device-settings", machine_name="desktop.tailnet.ts.net", tailscale_ips="[]", tags="[]"))
        db.commit()
    finally:
        db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        login_response = await client.post("/api/auth/login", json={"username": "admin", "password": "Test-secret-123!"})
        assert login_response.status_code == 200

        listing = await client.get("/api/tailscale/devices")
        assert listing.status_code == 200
        device = next(item for item in listing.json() if item["tailscale_id"] == "device-settings")
        assert device["machine_name"] == "desktop.tailnet.ts.net"
        assert device["display_name"] == "desktop.tailnet.ts.net"

        invalid = await client.patch(
            f"/api/tailscale/devices/{device['id']}/settings",
            json={"display_name": "Gaming Desktop", "supports_wol": True},
        )
        assert invalid.status_code == 422

        configured = await client.patch(
            f"/api/tailscale/devices/{device['id']}/settings",
            json={
                "display_name": "Gaming Desktop",
                "supports_wol": True,
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "lan_ip_address": "192.168.1.50",
                "broadcast_address": "192.168.1.255",
                "note": "Wake over LAN",
            },
        )
        assert configured.status_code == 200
        assert configured.json()["machine_name"] == "desktop.tailnet.ts.net"
        assert configured.json()["display_name"] == "Gaming Desktop"
        assert configured.json()["alias"] == "Gaming Desktop"
        assert configured.json()["supports_wol"] is True

        cleared = await client.patch(
            f"/api/tailscale/devices/{device['id']}/settings",
            json={
                "display_name": "",
                "supports_wol": False,
                "mac_address": None,
                "lan_ip_address": None,
                "broadcast_address": None,
                "note": None,
            },
        )
        assert cleared.status_code == 200
        assert cleared.json()["machine_name"] == "desktop.tailnet.ts.net"
        assert cleared.json()["display_name"] == "desktop.tailnet.ts.net"
        assert cleared.json()["alias"] is None
