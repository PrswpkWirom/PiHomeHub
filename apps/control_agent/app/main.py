from __future__ import annotations

import hashlib
import hmac
import json
import logging
# The agent uses only fixed arrays and a static allowlist.
import subprocess  # nosec B404
import asyncio
import time
from collections import deque

from fastapi import FastAPI, HTTPException, Request, status
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PIHOMEHUB_CONTROL_AGENT_", extra="ignore")
    secret: str
    services: str = "adguard-home,gitea,uptime-kuma,vaultwarden,mosquitto"

    @property
    def allowlist(self) -> frozenset[str]:
        return frozenset(item.strip() for item in self.services.split(",") if item.strip())

    @model_validator(mode="after")
    def validate_security(self) -> "Settings":
        supported = {"adguard-home", "gitea", "uptime-kuma", "vaultwarden", "mosquitto"}
        if len(self.secret) < 32:
            raise ValueError("control-agent secret must contain at least 32 characters")
        if not self.allowlist.issubset(supported):
            raise ValueError("control-agent services must come from the fixed Phase 1 allowlist")
        return self


settings = Settings()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_recent_nonces: deque[tuple[float, str]] = deque(maxlen=4096)
ALLOWED_ACTIONS = frozenset({"start", "stop", "restart"})


@app.get("/health", include_in_schema=False)
async def healthcheck():
    return {"status": "ok"}


def _authenticate(request: Request, body: bytes) -> None:
    timestamp = request.headers.get("x-control-timestamp", "")
    nonce = request.headers.get("x-control-nonce", "")
    supplied = request.headers.get("x-control-signature", "")
    try:
        request_time = int(timestamp)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    now = time.time()
    if abs(now - request_time) > 30 or not nonce or len(nonce) > 128:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    while _recent_nonces and _recent_nonces[0][0] < now - 60:
        _recent_nonces.popleft()
    if any(seen == nonce for _, seen in _recent_nonces):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    canonical = "\n".join(
        (timestamp, nonce, request.method.upper(), request.url.path, hashlib.sha256(body).hexdigest())
    )
    expected = hmac.new(settings.secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid control authentication")
    _recent_nonces.append((now, nonce))


def _inspect(slug: str) -> dict:
    try:
        # Slug is selected from the static allowlist.
        result = subprocess.run(  # nosec B603
            ["/usr/bin/docker", "inspect", slug], capture_output=True, text=True, check=False, timeout=5
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"slug": slug, "status": "unknown", "detail": "Docker status unavailable", "ports": []}
    if result.returncode != 0:
        return {"slug": slug, "status": "missing", "detail": "Container not found", "ports": []}
    try:
        payload = json.loads(result.stdout)[0]
    except (json.JSONDecodeError, IndexError, TypeError):
        return {"slug": slug, "status": "unknown", "detail": "Docker status unavailable", "ports": []}
    state = payload.get("State", {})
    state_name = str(state.get("Status", "unknown"))[:32]
    ports = []
    configured_bindings = (
        payload.get("NetworkSettings", {}).get("Ports", {})
        or payload.get("HostConfig", {}).get("PortBindings", {})
        or {}
    )
    for binding, host_bindings in configured_bindings.items():
        if "/" not in binding:
            continue
        container_raw, protocol = binding.split("/", 1)
        for host_binding in host_bindings or []:
            try:
                ports.append(
                    {
                        "container_port": int(container_raw),
                        "host_port": int(host_binding["HostPort"]),
                        "protocol": protocol,
                    }
                )
            except (KeyError, TypeError, ValueError):
                continue
    health = state.get("Health")
    health_status = health.get("Status") if isinstance(health, dict) else None
    if health_status not in {"healthy", "unhealthy", "starting"}:
        health_status = None
    return {"slug": slug, "status": state_name, "health_status": health_status, "detail": state_name.title(), "ports": ports}


@app.get("/v1/services")
async def service_status(request: Request):
    await request.body()
    _authenticate(request, b"")
    return await asyncio.to_thread(lambda: {"services": [_inspect(slug) for slug in sorted(settings.allowlist)]})


@app.post("/v1/services/{slug}/{action}")
async def service_action(slug: str, action: str, request: Request):
    body = await request.body()
    _authenticate(request, body)
    if slug not in settings.allowlist or action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service or action is not allowed")
    try:
        # Action and slug are both static-allowlisted.
        result = await asyncio.to_thread(
            subprocess.run,  # nosec B603
            ["/usr/bin/docker", action, slug], capture_output=True, text=True, check=False, timeout=120
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Docker is unavailable") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Docker operation timed out") from exc
    if result.returncode != 0:
        logger.warning("Docker operation failed for allowlisted service %s action %s", slug, action)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Docker operation failed")
    return {"ok": True, "slug": slug, "action": action}
