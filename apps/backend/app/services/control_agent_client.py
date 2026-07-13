from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from typing import Any

import httpx

from app.core.config import get_settings


class ControlAgentError(RuntimeError):
    pass


def _signature(method: str, path: str, body: bytes, timestamp: str, nonce: str) -> str:
    canonical = "\n".join((timestamp, nonce, method.upper(), path, hashlib.sha256(body).hexdigest()))
    return hmac.new(
        get_settings().control_agent_secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _request(method: str, path: str, *, timeout: float = 8.0) -> dict[str, Any]:
    body = b""
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    headers = {
        "X-Control-Timestamp": timestamp,
        "X-Control-Nonce": nonce,
        "X-Control-Signature": _signature(method, path, body, timestamp, nonce),
    }
    try:
        with httpx.Client(base_url=get_settings().control_agent_url, timeout=timeout) as client:
            response = client.request(method, path, content=body, headers=headers)
    except httpx.HTTPError as exc:
        raise ControlAgentError("Control agent is unavailable") from exc
    if response.status_code == 404:
        raise ControlAgentError("Service or action is not allowed")
    if response.status_code >= 400:
        raise ControlAgentError("Control agent rejected the operation")
    try:
        payload = response.json()
    except ValueError as exc:
        raise ControlAgentError("Control agent returned an invalid response") from exc
    if not isinstance(payload, dict):
        raise ControlAgentError("Control agent returned an invalid response")
    return payload


def get_service_snapshot() -> list[dict[str, Any]]:
    payload = _request("GET", "/v1/services")
    services = payload.get("services", [])
    return services if isinstance(services, list) else []


def request_service_action(slug: str, action: str) -> dict[str, Any]:
    # The agent allows Docker lifecycle operations up to 120 seconds. Keep the
    # caller alive slightly longer so it never reports failure while Docker is
    # still changing state.
    return _request("POST", f"/v1/services/{slug}/{action}", timeout=125.0)
