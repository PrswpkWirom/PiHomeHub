from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
from collections import deque

from fastapi import FastAPI, HTTPException, Request, status
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PIHOMEHUB_WOL_AGENT_", extra="ignore")
    secret: str

    @model_validator(mode="after")
    def validate_security(self) -> "Settings":
        if len(self.secret) < 32:
            raise ValueError("WOL agent secret must contain at least 32 characters")
        return self


settings = Settings()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_recent_nonces: deque[tuple[float, str]] = deque(maxlen=4096)


def _authenticate(request: Request, body: bytes) -> None:
    timestamp = request.headers.get("x-control-timestamp", "")
    nonce = request.headers.get("x-control-nonce", "")
    supplied = request.headers.get("x-control-signature", "")
    try:
        request_time = int(timestamp)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent authentication")
    now = time.time()
    if abs(now - request_time) > 30 or not nonce or len(nonce) > 128:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent authentication")
    while _recent_nonces and _recent_nonces[0][0] < now - 60:
        _recent_nonces.popleft()
    if any(seen == nonce for _, seen in _recent_nonces):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent authentication")
    canonical = "\n".join(
        (timestamp, nonce, request.method.upper(), request.url.path, hashlib.sha256(body).hexdigest())
    )
    expected = hmac.new(settings.secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid agent authentication")
    _recent_nonces.append((now, nonce))


def _send_magic_packet(mac_address: str, broadcast_address: str) -> None:
    clean_mac = mac_address.replace(":", "").replace("-", "")
    if len(clean_mac) != 12 or any(character not in "0123456789abcdefABCDEF" for character in clean_mac):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid MAC address")
    try:
        destination = str(ipaddress.IPv4Address(broadcast_address))
    except ipaddress.AddressValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid IPv4 broadcast address"
        ) from exc

    packet = bytes.fromhex("FF" * 6 + clean_mac * 16)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            for _ in range(3):
                sock.sendto(packet, (destination, 9))
    except OSError as exc:
        logger.warning("Wake-on-LAN packet could not be sent: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Wake-on-LAN packet could not be sent"
        ) from exc


@app.post("/v1/wake")
async def wake_on_lan(request: Request):
    body = await request.body()
    _authenticate(request, body)
    try:
        payload = json.loads(body)
        mac_address = payload["mac_address"]
        broadcast_address = payload.get("broadcast_address") or "255.255.255.255"
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid wake request") from exc
    if not isinstance(mac_address, str) or not isinstance(broadcast_address, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid wake request")
    _send_magic_packet(mac_address, broadcast_address)
    return {"ok": True}
