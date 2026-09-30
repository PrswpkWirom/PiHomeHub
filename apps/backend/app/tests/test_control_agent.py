from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import subprocess
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def control_agent(monkeypatch, tmp_path):
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_SECRET", "testing-control-agent-secret-long-enough")
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_OPERATIONS_DB", str(tmp_path / "operations.db"))
    catalog = {
        "project": "infra",
        "services": [
            {"slug": slug, "host_ip": "100.64.1.2", "ports": {"http": 3000},
             "requires_setup": slug == "mosquitto", "setup_ready": slug != "mosquitto"}
            for slug in ("adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto")
        ],
    }
    catalog_path = tmp_path / "services.json"
    catalog_path.write_text(json.dumps(catalog))
    manifest = {"name": "infra", "services": {
        slug: {"container_name": slug, "image": f"example/{slug}:1@sha256:" + "a" * 64}
        for slug in ("adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto")
    }}
    manifest_path = tmp_path / "compose.json"
    manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_CATALOG_FILE", str(catalog_path))
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_COMPOSE_FILE", str(manifest_path))
    path = Path(__file__).parents[4] / "apps" / "control_agent" / "app" / "main.py"
    spec = importlib.util.spec_from_file_location(f"pihomehub_test_control_agent_{time.time_ns()}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _headers(method: str, path: str, *, body: bytes = b"", nonce: str = "unique-nonce") -> dict[str, str]:
    timestamp = str(int(time.time()))
    canonical = "\n".join((timestamp, nonce, method, path, hashlib.sha256(body).hexdigest()))
    signature = hmac.new(b"testing-control-agent-secret-long-enough", canonical.encode(), hashlib.sha256).hexdigest()
    return {"X-Control-Timestamp": timestamp, "X-Control-Nonce": nonce, "X-Control-Signature": signature}


def _running_info(slug="adguard-home"):
    return {"slug": slug, "status": "running", "detail": "Running", "health_status": None,
            "ports": [], "started_at": "2026-09-30T00:00:00Z",
            "labels": {"com.docker.compose.project": "infra", "com.docker.compose.service": slug}}


class _DormantThread:
    def __init__(self, *args, **kwargs):
        pass

    def start(self):
        pass


@pytest.mark.anyio
async def test_agent_liveness_does_not_run_docker_or_expose_configuration(control_agent):
    with patch.object(control_agent.subprocess, "run") as docker:
        async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
            response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    docker.assert_not_called()


def test_inspect_treats_only_a_missing_container_as_missing(control_agent):
    with patch.object(control_agent.subprocess, "run") as docker:
        docker.return_value.returncode = 1
        docker.return_value.stderr = "Error response from daemon: No such object: adguard-home"
        assert control_agent._inspect("adguard-home")["status"] == "missing"
        docker.return_value.stderr = "Cannot connect to the Docker daemon"
        with pytest.raises(HTTPException) as error:
            control_agent._inspect("adguard-home")
    assert error.value.status_code == 503


def test_inspect_reports_health_and_configured_bindings(control_agent):
    payload = [{"State": {"Status": "running", "StartedAt": "now", "Health": {"Status": "unhealthy", "Log": [{"Output": "secret"}]}},
                "NetworkSettings": {"Ports": None},
                "HostConfig": {"PortBindings": {"53/tcp": [{"HostIp": "100.64.1.2", "HostPort": "53"}]}}}]
    with patch.object(control_agent.subprocess, "run") as docker:
        docker.return_value.returncode = 0
        docker.return_value.stdout = json.dumps(payload)
        result = control_agent._inspect("adguard-home")
    assert result["health_status"] == "unhealthy"
    assert result["ports"][0]["host_port"] == 53
    assert "secret" not in json.dumps(result)


def test_operation_journal_is_durable_idempotent_and_single_flight(control_agent, monkeypatch):
    monkeypatch.setattr(control_agent, "_inspect", _running_info)
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)
    operation_id = "operation-restart-0001"
    first = control_agent._enqueue("adguard-home", "restart", operation_id, 7)
    retry = control_agent._enqueue("adguard-home", "restart", operation_id, 7)
    assert retry["operation_id"] == first["operation_id"]
    assert retry["state"] == "queued"
    with pytest.raises(HTTPException) as conflict:
        control_agent._enqueue("adguard-home", "stop", operation_id, 7)
    assert conflict.value.status_code == 409
    with pytest.raises(HTTPException) as busy:
        control_agent._enqueue("adguard-home", "restart", "operation-restart-0002", 8)
    assert busy.value.status_code == 409
    with control_agent._connection() as db:
        assert db.execute("SELECT COUNT(*) FROM operations").fetchone()[0] == 1


@pytest.mark.anyio
async def test_hmac_protects_operation_submission_and_bad_actions_do_not_run_docker(control_agent):
    path = "/v1/services/adguard-home/actions/shell"
    body = b'{"operation_id":"operation-invalid-0001","actor_user_id":1}'
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        response = await client.post(path, content=body, headers=_headers("POST", path, body=body))
    assert response.status_code == 404


@pytest.mark.anyio
async def test_mosquitto_creation_requires_a_matching_password_and_acl(control_agent, monkeypatch):
    monkeypatch.setattr(control_agent, "_inspect", lambda slug: {**_running_info(slug), "status": "missing", "labels": {}})
    with pytest.raises(HTTPException) as error:
        control_agent._enqueue("mosquitto", "create", "operation-mosquitto-0001", 7)
    assert error.value.status_code == 409
    assert "setup required" in error.value.detail


def test_restarted_agent_reconciles_observed_restart_without_replaying(control_agent, monkeypatch):
    monkeypatch.setattr(control_agent, "_inspect", _running_info)
    control_agent._enqueue("adguard-home", "restart", "operation-restart-0003", 7)
    with control_agent._connection() as db:
        db.execute("UPDATE operations SET state='running',stage='restarting' WHERE operation_id=?", ("operation-restart-0003",))
    result = control_agent._reconcile(control_agent._read_operation("operation-restart-0003"))
    assert result["state"] == "unknown"
    assert result["error_code"] == "AGENT_RESTARTED"
    with patch.object(control_agent.subprocess, "run") as docker:
        docker.assert_not_called()


@pytest.mark.anyio
async def test_operation_poll_keeps_active_work_running(control_agent, monkeypatch):
    monkeypatch.setattr(control_agent, "_inspect", _running_info)
    with patch.object(control_agent.threading, "Thread", _DormantThread):
        operation = control_agent._enqueue("adguard-home", "stop", "operation-stop-poll-0001", 7)
    path = f"/v1/operations/{operation['operation_id']}"
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        response = await client.get(path, headers=_headers("GET", path))
    assert response.status_code == 200
    assert response.json()["operation"]["state"] == "queued"
    assert control_agent._read_operation(operation["operation_id"])["state"] == "queued"


def test_success_clears_transient_reconciliation_error(control_agent):
    with control_agent._connection() as db:
        db.execute("INSERT INTO operations(operation_id,slug,action,state,stage,created_at,updated_at,error_code) "
                   "VALUES(?,?,?,?,?,?,?,?)", ("operation-clear-error-0001", "gitea", "start", "unknown",
                   "verifying", control_agent._now(), control_agent._now(), "AGENT_RESTARTED"))
    control_agent._update("operation-clear-error-0001", state="succeeded", stage="complete", terminal=True)
    assert control_agent._read_operation("operation-clear-error-0001")["error_code"] is None


def test_agent_startup_repairs_completed_operations_with_old_error_codes(control_agent):
    with control_agent._connection() as db:
        db.execute("INSERT INTO operations(operation_id,slug,action,state,stage,created_at,updated_at,error_code) "
                   "VALUES(?,?,?,?,?,?,?,?)", ("operation-old-error-0001", "gitea", "start", "succeeded",
                   "complete", control_agent._now(), control_agent._now(), "AGENT_RESTARTED"))
    control_agent.recover_after_restart()
    assert control_agent._read_operation("operation-old-error-0001")["error_code"] is None


def test_safe_compose_error_is_actionable_without_leaking_docker_output(control_agent):
    assert control_agent._safe_error("Bind for 100.64.1.2:3001 failed: port is already allocated") == (
        "PORT_IN_USE", "A configured host port is already in use."
    )
    assert "secret" not in control_agent._safe_error("secret internal image issue")[1]


def test_create_pulls_uses_fixed_compose_manifest_and_verifies_running_container(control_agent, monkeypatch):
    calls = []
    inspection = {"slug": "gitea", "status": "missing", "started_at": None, "labels": {}, "ports": []}
    monkeypatch.setattr(control_agent, "_inspect", lambda slug: dict(inspection))
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)
    monkeypatch.setattr(control_agent, "_docker", lambda args, timeout=10: (calls.append((args, timeout)) or subprocess.CompletedProcess(args, 0, "", "")))

    operation = control_agent._enqueue("gitea", "create", "operation-gitea-create-0001", 7)
    assert operation["state"] == "queued"
    inspection.update({"status": "running", "started_at": "new-started-at",
                       "labels": {"com.docker.compose.project": "infra", "com.docker.compose.service": "gitea"}})
    control_agent._execute(operation["operation_id"])

    stored = control_agent._read_operation(operation["operation_id"])
    assert stored["state"] == "succeeded"
    assert [call[0][7] for call in calls] == ["pull", "create", "start"]
    assert calls[1][0] == ["compose", "--project-name", "infra", "--profile", "*", "-f",
                            control_agent.settings.compose_file, "create", "gitea"]
    assert all(call[0][1:4] == ["--project-name", "infra", "--profile"] for call in calls)
    assert all("gitea" in call[0] for call in calls)
    assert 0 < calls[0][1] <= 600
    assert all(timeout <= 600 for _, timeout in calls)


def test_restart_verification_uses_changed_docker_start_time(control_agent):
    original = {"action": "restart", "before_started_at": "before"}
    assert control_agent._expected(original, {"status": "running", "started_at": "after"}) is True
    assert control_agent._expected(original, {"status": "running", "started_at": "before"}) is False


@pytest.mark.parametrize(
    ("action", "initial_state", "final_state"),
    [("start", "created", "running"), ("start", "exited", "running"), ("stop", "running", "exited"), ("restart", "running", "running")],
)
def test_lifecycle_actions_verify_observed_container_state(control_agent, monkeypatch, action, initial_state, final_state):
    slug = "gitea"
    initial = {**_running_info(slug), "status": initial_state,
               "started_at": None if initial_state == "created" else "before"}
    inspection = dict(initial)
    calls = []
    monkeypatch.setattr(control_agent, "_inspect", lambda _: dict(inspection))
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)
    monkeypatch.setattr(control_agent, "_docker", lambda args, timeout=10: (calls.append(args) or subprocess.CompletedProcess(args, 0, "", "")))
    operation = control_agent._enqueue(slug, action, f"operation-{action}-{initial_state}-0001", 7)
    inspection.update({"status": final_state, "started_at": "after" if action == "restart" else "started"})

    control_agent._execute(operation["operation_id"])

    assert control_agent._read_operation(operation["operation_id"])["state"] == "succeeded"
    assert calls == [[action, slug]]


def test_running_unhealthy_container_completes_lifecycle_but_reports_health_separately(control_agent, monkeypatch):
    info = {**_running_info("gitea"), "health_status": None}
    monkeypatch.setattr(control_agent, "_inspect", lambda _: dict(info))
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)
    monkeypatch.setattr(control_agent, "_docker", lambda args, timeout=10: subprocess.CompletedProcess(args, 0, "", ""))
    operation = control_agent._enqueue("gitea", "restart", "operation-unhealthy-restart-0001", 7)
    info.update({"started_at": "after", "health_status": "unhealthy"})

    control_agent._execute(operation["operation_id"])

    assert control_agent._read_operation(operation["operation_id"])["state"] == "succeeded"
    assert control_agent._inspect("gitea")["health_status"] == "unhealthy"


def test_create_image_pull_failure_is_actionable(control_agent, monkeypatch):
    info = {"slug": "gitea", "status": "missing", "started_at": None, "labels": {}, "ports": []}
    monkeypatch.setattr(control_agent, "_inspect", lambda _: dict(info))
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)
    monkeypatch.setattr(control_agent, "_docker", lambda args, timeout=10: subprocess.CompletedProcess(args, 1, "", "pull access denied for image"))
    operation = control_agent._enqueue("gitea", "create", "operation-image-failure-0001", 7)

    control_agent._execute(operation["operation_id"])

    stored = control_agent._read_operation(operation["operation_id"])
    assert stored["state"] == "failed"
    assert stored["error_code"] == "IMAGE_UNAVAILABLE"
    assert "image" in stored["message"].lower()


def test_lifecycle_port_conflict_is_actionable(control_agent, monkeypatch):
    info = {**_running_info("gitea"), "status": "exited"}
    monkeypatch.setattr(control_agent, "_inspect", lambda _: dict(info))
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)
    monkeypatch.setattr(control_agent, "_docker", lambda args, timeout=10: subprocess.CompletedProcess(args, 1, "", "port is already allocated"))
    operation = control_agent._enqueue("gitea", "start", "operation-port-conflict-0001", 7)

    control_agent._execute(operation["operation_id"])

    stored = control_agent._read_operation(operation["operation_id"])
    assert stored["state"] == "failed"
    assert stored["error_code"] == "PORT_IN_USE"


def test_restart_without_a_baseline_timestamp_stays_unknown_when_unverifiable(control_agent, monkeypatch):
    monkeypatch.setattr(control_agent, "_inspect", lambda _: {**_running_info(), "started_at": None})
    with control_agent._connection() as db:
        db.execute(
            "INSERT INTO operations(operation_id,slug,action,state,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            ("operation-restart-no-baseline-0001", "adguard-home", "restart", "running", "restarting", control_agent._now(), control_agent._now()),
        )
    result = control_agent._reconcile(control_agent._read_operation("operation-restart-no-baseline-0001"))
    assert result["state"] == "unknown"


def test_mosquitto_creation_unlocks_after_matching_setup(control_agent, monkeypatch):
    catalog_path = Path(control_agent.settings.catalog_file)
    catalog = json.loads(catalog_path.read_text())
    next(entry for entry in catalog["services"] if entry["slug"] == "mosquitto")["setup_ready"] = True
    catalog_path.write_text(json.dumps(catalog))
    monkeypatch.setattr(control_agent, "_inspect", lambda slug: {**_running_info(slug), "status": "missing", "labels": {}})
    monkeypatch.setattr(control_agent.threading, "Thread", _DormantThread)

    operation = control_agent._enqueue("mosquitto", "create", "operation-mosquitto-ready-0001", 7)

    assert operation["state"] == "queued"
