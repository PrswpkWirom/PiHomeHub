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
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def control_agent(monkeypatch):
    monkeypatch.setenv("PIHOMEHUB_CONTROL_AGENT_SECRET", "testing-control-agent-secret-long-enough")
    path = Path(__file__).parents[4] / "apps" / "control_agent" / "app" / "main.py"
    spec = importlib.util.spec_from_file_location("pihomehub_test_control_agent", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _headers(method: str, path: str, *, nonce: str = "unique-nonce") -> dict[str, str]:
    timestamp = str(int(time.time()))
    canonical = "\n".join((timestamp, nonce, method, path, hashlib.sha256(b"").hexdigest()))
    signature = hmac.new(
        b"testing-control-agent-secret-long-enough", canonical.encode(), hashlib.sha256
    ).hexdigest()
    return {
        "X-Control-Timestamp": timestamp,
        "X-Control-Nonce": nonce,
        "X-Control-Signature": signature,
    }


@pytest.mark.anyio
async def test_agent_liveness_does_not_run_docker_or_expose_configuration(control_agent):
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        with patch.object(control_agent.subprocess, "run") as docker:
            response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
        docker.assert_not_called()


@pytest.mark.anyio
async def test_control_agent_requires_hmac_and_rejects_replay(control_agent):
    path = "/v1/services"
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        missing = await client.get(path)
        with patch.object(control_agent.subprocess, "run") as docker:
            docker.return_value.returncode = 1
            first = await client.get(path, headers=_headers("GET", path))
            replay = await client.get(path, headers=_headers("GET", path))
    assert missing.status_code == 401
    assert first.status_code == 200
    assert replay.status_code == 401


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("slug", "action"),
    [
        ("backend", "stop"),
        ("adguard-home;rm", "stop"),
        ("adguard-home", "delete"),
        ("../adguard-home", "restart"),
    ],
)
async def test_control_agent_rejects_unknown_and_shell_like_operations(control_agent, slug, action):
    path = f"/v1/services/{slug}/{action}"
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        with patch.object(control_agent.subprocess, "run") as docker:
            response = await client.post(path, headers=_headers("POST", path, nonce=f"nonce-{slug}-{action}"))
    assert response.status_code == 404
    docker.assert_not_called()


@pytest.mark.anyio
async def test_control_agent_uses_fixed_argument_array(control_agent):
    path = "/v1/services/adguard-home/restart"
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        with patch.object(control_agent.subprocess, "run") as docker:
            docker.return_value.returncode = 0
            response = await client.post(path, headers=_headers("POST", path, nonce="restart-nonce"))
    assert response.status_code == 200
    assert docker.call_args.args[0] == ["/usr/bin/docker", "restart", "adguard-home"]
    assert docker.call_args.kwargs["timeout"] == 120
    assert "shell" not in docker.call_args.kwargs


def test_control_agent_reports_configured_bindings_for_stopped_container(control_agent):
    payload = [{
        "State": {"Status": "exited"},
        "NetworkSettings": {"Ports": None},
        "HostConfig": {"PortBindings": {"53/tcp": [{"HostPort": "53"}], "53/udp": [{"HostPort": "53"}]}},
    }]
    with patch.object(control_agent.subprocess, "run") as docker:
        docker.return_value.returncode = 0
        docker.return_value.stdout = json.dumps(payload)
        result = control_agent._inspect("adguard-home")

    assert result["status"] == "exited"
    assert {(port["protocol"], port["host_port"]) for port in result["ports"]} == {("tcp", 53), ("udp", 53)}


def test_control_agent_reports_health_status_without_exposing_health_output(control_agent):
    payload = [{"State": {"Status": "running", "Health": {"Status": "unhealthy", "Log": [{"Output": "secret response"}]}}}]
    with patch.object(control_agent.subprocess, "run") as docker:
        docker.return_value.returncode = 0
        docker.return_value.stdout = json.dumps(payload)
        result = control_agent._inspect("vaultwarden")
    assert result["status"] == "running"
    assert result["health_status"] == "unhealthy"
    assert "Log" not in json.dumps(result)
    assert "secret response" not in json.dumps(result)


@pytest.mark.anyio
async def test_control_agent_timeout_is_sanitized(control_agent):
    path = "/v1/services/adguard-home/start"
    async with AsyncClient(transport=ASGITransport(app=control_agent.app), base_url="http://agent") as client:
        with patch.object(
            control_agent.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired(["docker", "start", "adguard-home"], 120, stderr="secret"),
        ):
            response = await client.post(path, headers=_headers("POST", path, nonce="timeout-nonce"))
    assert response.status_code == 504
    assert "secret" not in response.text


def test_backend_waits_for_agent_action_timeout_contract():
    from app.services.control_agent_client import request_service_action

    with patch("app.services.control_agent_client.httpx.Client") as client_class:
        response = client_class.return_value.__enter__.return_value.request.return_value
        response.status_code = 200
        response.json.return_value = {"ok": True}
        request_service_action("adguard-home", "restart")

    assert client_class.call_args.kwargs["timeout"] == 125.0
