from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import httpx

from app.core.config import get_settings


class ControlAgentError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _signature(method: str, path: str, body: bytes, timestamp: str, nonce: str) -> str:
    canonical = "\n".join((timestamp, nonce, method.upper(), path, hashlib.sha256(body).hexdigest()))
    return hmac.new(
        get_settings().control_agent_secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _request(
    method: str,
    path: str,
    *,
    base_url: str | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 8.0,
) -> dict[str, Any]:
    body = b"" if json_body is None else json.dumps(json_body, separators=(",", ":")).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    headers = {
        "X-Control-Timestamp": timestamp,
        "X-Control-Nonce": nonce,
        "X-Control-Signature": _signature(method, path, body, timestamp, nonce),
    }
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    try:
        with httpx.Client(base_url=base_url or get_settings().control_agent_url, timeout=timeout) as client:
            response = client.request(method, path, content=body, headers=headers)
    except httpx.HTTPError as exc:
        raise ControlAgentError("Control agent is unavailable") from exc
    if response.status_code >= 400:
        raise ControlAgentError("Control agent rejected the request", status_code=response.status_code)
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


def request_service_action(slug: str, action: str, operation_id: str, actor_user_id: int) -> dict[str, Any]:
    return _request("POST", f"/v1/services/{slug}/actions/{action}",
                    json_body={"operation_id": operation_id, "actor_user_id": actor_user_id}, timeout=8.0)


def get_service_operation(operation_id: str) -> dict[str, Any]:
    return _request("GET", f"/v1/operations/{operation_id}")


def request_wake_on_lan(mac_address: str, broadcast_address: str) -> None:
    _request(
        "POST",
        "/v1/wake",
        base_url=get_settings().wol_agent_url,
        json_body={"mac_address": mac_address, "broadcast_address": broadcast_address},
    )
