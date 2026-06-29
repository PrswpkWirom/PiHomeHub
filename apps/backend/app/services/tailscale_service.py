from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from cryptography.fernet import InvalidToken
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import decrypt_secret, encrypt_secret
from app.models.tailscale_device import TailscaleDevice
from app.models.user import AppSetting
from app.schemas.tailscale import (
    TailscaleConnectionResult,
    TailscaleDeviceSettingsUpdate,
    TailscaleDeviceRead,
    TailscaleSettingsWrite,
    TailscaleStatus,
    TailscaleWolUpdate,
)
from app.services.wol_service import _send_magic_packet

TAILSCALE_API_BASE = "https://api.tailscale.com/api/v2"
TOKEN_KEY = "tailscale_api_token"
TAILNET_KEY = "tailscale_tailnet"
LAST_SYNC_KEY = "tailscale_last_sync_at"
LAST_ERROR_KEY = "tailscale_last_sync_error"
ONLINE_LAST_SEEN_WINDOW = timedelta(minutes=10)


def _get_setting(db: Session, key: str) -> str | None:
    setting = db.query(AppSetting).filter(AppSetting.key == key).one_or_none()
    return setting.value if setting else None


def _set_setting(db: Session, key: str, value: str) -> None:
    setting = db.query(AppSetting).filter(AppSetting.key == key).one_or_none()
    if setting is None:
        db.add(AppSetting(key=key, value=value))
        return
    setting.value = value


def _delete_setting(db: Session, key: str) -> None:
    db.query(AppSetting).filter(AppSetting.key == key).delete()


def _get_token(db: Session) -> str | None:
    encrypted = _get_setting(db, TOKEN_KEY)
    if not encrypted:
        return None
    try:
        return decrypt_secret(encrypted)
    except InvalidToken as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored Tailscale token cannot be decrypted with the current secret key",
        ) from exc


def get_tailscale_status(db: Session) -> TailscaleStatus:
    token_saved = _get_setting(db, TOKEN_KEY) is not None
    tailnet = _get_setting(db, TAILNET_KEY)
    last_error = _get_setting(db, LAST_ERROR_KEY)
    return TailscaleStatus(
        token_saved=token_saved,
        tailnet=tailnet,
        connected=bool(token_saved and tailnet and not last_error),
        last_sync_at=_get_setting(db, LAST_SYNC_KEY),
        last_sync_error=last_error,
    )


def save_tailscale_settings(db: Session, payload: TailscaleSettingsWrite) -> TailscaleStatus:
    if payload.api_token:
        _set_setting(db, TOKEN_KEY, encrypt_secret(payload.api_token))
    _set_setting(db, TAILNET_KEY, payload.tailnet)
    _delete_setting(db, LAST_ERROR_KEY)
    db.commit()
    return get_tailscale_status(db)


async def _fetch_devices(api_token: str, tailnet: str) -> list[dict[str, Any]]:
    url = f"{TAILSCALE_API_BASE}/tailnet/{tailnet}/devices"
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url, headers={"Authorization": f"Bearer {api_token}"})

    if response.status_code == 401:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tailscale token was rejected")
    if response.status_code == 404:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tailscale tailnet was not found")
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Tailscale API returned {response.status_code}",
        )

    payload = response.json()
    return payload.get("devices", [])


async def test_tailscale_connection(db: Session) -> TailscaleConnectionResult:
    token = _get_token(db)
    tailnet = _get_setting(db, TAILNET_KEY)
    if not token or not tailnet:
        return TailscaleConnectionResult(ok=False, message="Tailscale token and tailnet are required")

    try:
        await _fetch_devices(token, tailnet)
    except HTTPException as exc:
        return TailscaleConnectionResult(ok=False, message=str(exc.detail))
    except Exception as exc:
        return TailscaleConnectionResult(ok=False, message=str(exc))

    return TailscaleConnectionResult(ok=True, message="Tailscale connection succeeded")


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _device_identity(device: dict[str, Any]) -> str:
    return str(device.get("id") or device.get("nodeId") or device.get("machineKey") or device.get("name"))


def _device_name(device: dict[str, Any]) -> str:
    return str(device.get("name") or device.get("hostname") or _device_identity(device))


def _is_device_online(device: dict[str, Any], last_seen: datetime | None, now: datetime) -> bool:
    connected_to_control = device.get("connectedToControl")
    if isinstance(connected_to_control, bool):
        return connected_to_control

    explicit_online = device.get("online")
    if isinstance(explicit_online, bool):
        return explicit_online
    if last_seen is None:
        return False

    comparable_last_seen = last_seen
    if comparable_last_seen.tzinfo is None:
        comparable_last_seen = comparable_last_seen.replace(tzinfo=UTC)
    return comparable_last_seen >= now - ONLINE_LAST_SEEN_WINDOW


def _to_read(device: TailscaleDevice) -> TailscaleDeviceRead:
    return TailscaleDeviceRead(
        id=device.id,
        tailscale_id=device.tailscale_id,
        node_id=device.node_id,
        machine_name=device.machine_name,
        display_name=device.alias or device.machine_name,
        hostname=device.hostname,
        tailscale_ips=json.loads(device.tailscale_ips or "[]"),
        os=device.os,
        online=device.online,
        last_seen=device.last_seen,
        tags=json.loads(device.tags or "[]"),
        sync_status=device.sync_status,
        last_synced_at=device.last_synced_at,
        supports_wol=device.supports_wol,
        mac_address=device.mac_address,
        lan_ip_address=device.lan_ip_address,
        broadcast_address=device.broadcast_address,
        alias=device.alias,
        note=device.note,
    )


async def sync_tailscale_devices(db: Session) -> list[TailscaleDeviceRead]:
    token = _get_token(db)
    tailnet = _get_setting(db, TAILNET_KEY)
    if not token or not tailnet:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tailscale token and tailnet are required")

    try:
        devices = await _fetch_devices(token, tailnet)
    except HTTPException as exc:
        _set_setting(db, LAST_ERROR_KEY, str(exc.detail))
        db.commit()
        raise
    except Exception as exc:
        _set_setting(db, LAST_ERROR_KEY, str(exc))
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to reach Tailscale API") from exc

    now = datetime.now(UTC)
    seen_ids: set[str] = set()

    for payload in devices:
        tailscale_id = _device_identity(payload)
        if not tailscale_id:
            continue
        seen_ids.add(tailscale_id)
        record = db.query(TailscaleDevice).filter(TailscaleDevice.tailscale_id == tailscale_id).one_or_none()
        if record is None:
            record = TailscaleDevice(tailscale_id=tailscale_id, machine_name=_device_name(payload))
            db.add(record)

        last_seen = _parse_datetime(payload.get("lastSeen"))
        record.node_id = str(payload.get("nodeId")) if payload.get("nodeId") is not None else None
        record.machine_name = _device_name(payload)
        record.hostname = payload.get("hostname")
        record.tailscale_ips = json.dumps(payload.get("addresses") or [])
        record.os = payload.get("os")
        record.online = _is_device_online(payload, last_seen, now)
        record.last_seen = last_seen
        record.tags = json.dumps(payload.get("tags") or [])
        record.sync_status = "active"
        record.last_synced_at = now

    db.query(TailscaleDevice).filter(
        TailscaleDevice.tailscale_id.notin_(seen_ids),
        TailscaleDevice.sync_status == "active",
    ).update({"sync_status": "missing_from_tailnet"}, synchronize_session=False)

    _set_setting(db, LAST_SYNC_KEY, now.isoformat())
    _delete_setting(db, LAST_ERROR_KEY)
    db.commit()
    return list_tailscale_devices(db)


def list_tailscale_devices(db: Session) -> list[TailscaleDeviceRead]:
    rows = db.query(TailscaleDevice).order_by(TailscaleDevice.machine_name.asc()).all()
    return [_to_read(row) for row in rows]


def update_tailscale_wol(db: Session, device_id: int, payload: TailscaleWolUpdate) -> TailscaleDeviceRead:
    device = db.query(TailscaleDevice).filter(TailscaleDevice.id == device_id).one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tailscale device not found")
    if payload.supports_wol and not payload.mac_address:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="MAC address is required for WOL")

    for key, value in payload.model_dump().items():
        setattr(device, key, value)

    db.commit()
    db.refresh(device)
    return _to_read(device)


def update_tailscale_device_settings(
    db: Session, device_id: int, payload: TailscaleDeviceSettingsUpdate
) -> TailscaleDeviceRead:
    device = db.query(TailscaleDevice).filter(TailscaleDevice.id == device_id).one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tailscale device not found")
    if payload.supports_wol and not payload.mac_address:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="MAC address is required for WOL")

    display_name = payload.display_name.strip() if payload.display_name else None
    device.alias = display_name or None
    device.supports_wol = payload.supports_wol
    device.mac_address = payload.mac_address
    device.lan_ip_address = payload.lan_ip_address
    device.broadcast_address = payload.broadcast_address
    device.note = payload.note

    db.commit()
    db.refresh(device)
    return _to_read(device)


def wake_tailscale_device(db: Session, device_id: int) -> None:
    device = db.query(TailscaleDevice).filter(TailscaleDevice.id == device_id).one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tailscale device not found")
    if not device.supports_wol or not device.mac_address:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WOL is not configured for this device")

    _send_magic_packet(device.mac_address, device.broadcast_address or "255.255.255.255")
