from __future__ import annotations

import hashlib
import hmac
import importlib.util
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
