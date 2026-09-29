from __future__ import annotations

import json
# Fixed executable and argument array; no shell is used.
import subprocess  # nosec B404

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.device import Device
from app.models.user import AppSetting
from app.models.notification import MonitorState
from app.schemas.devices import DeviceCreate, DeviceSummary, DeviceUpdate

DELETED_KNOWN_DEVICES_KEY = "deleted_known_device_names"


def _known_device_names() -> set[str]:
    return {item["name"] for item in get_settings().known_devices_seed if item.get("name")}


def _deleted_known_device_names(db: Session) -> set[str]:
    setting = db.query(AppSetting).filter(AppSetting.key == DELETED_KNOWN_DEVICES_KEY).one_or_none()
    if setting is None:
        return set()
    try:
        return set(json.loads(setting.value))
    except json.JSONDecodeError:
        return set()


def _remember_deleted_known_device(db: Session, name: str | None) -> None:
    if not name or name not in _known_device_names():
        return
    deleted_names = _deleted_known_device_names(db)
    deleted_names.add(name)
    value = json.dumps(sorted(deleted_names))
    setting = db.query(AppSetting).filter(AppSetting.key == DELETED_KNOWN_DEVICES_KEY).one_or_none()
    if setting is None:
        db.add(AppSetting(key=DELETED_KNOWN_DEVICES_KEY, value=value))
        return
    setting.value = value


def _ping_host(host: str | None) -> str:
    if not host:
        return "unknown"
    try:
        # The host follows -- and cannot become an executable option.
        result = subprocess.run(  # nosec B603
            ["/usr/bin/ping", "-c", "1", "-W", "1", "--", host],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return "unknown"
    return "online" if result.returncode == 0 else "offline"


def get_devices(db: Session) -> list[DeviceSummary]:
    return [
        DeviceSummary(
            id=device.id,
            name=device.name,
            device_type=device.device_type,
            ip_address=device.ip_address,
            tailscale_name=device.tailscale_name,
            mac_address=device.mac_address,
            broadcast_address=device.broadcast_address,
            supports_wol=device.supports_wol,
            status=_monitored_device_status(db, device.id) or "unknown",
            description=device.description,
        )
        for device in db.query(Device).order_by(Device.name.asc()).all()
    ]


def _monitored_device_status(db: Session, device_id: int) -> str | None:
    import json

    row = db.query(MonitorState).filter(MonitorState.key == f"device:{device_id}").one_or_none()
    if row is None:
        return None
    try:
        state = json.loads(row.value_json).get("stable")
        return state if state in {"online", "offline"} else None
    except (ValueError, AttributeError):
        return None


def create_device(db: Session, payload: DeviceCreate) -> Device:
    existing = db.query(Device).filter(Device.name == payload.name).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A manual device with this name already exists.")

    device = Device(**payload.model_dump())
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def update_device(db: Session, device_id: int, payload: DeviceUpdate) -> Device | None:
    device = db.query(Device).filter(Device.id == device_id).one_or_none()
    if device is None:
        return None

    original_name = device.name
    if payload.name and payload.name != original_name:
        existing = db.query(Device).filter(Device.name == payload.name).one_or_none()
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A manual device with this name already exists.")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(device, key, value)
    if device.name != original_name:
        _remember_deleted_known_device(db, original_name)

    db.commit()
    db.refresh(device)
    return device


def delete_device(db: Session, device_id: int) -> bool:
    device = db.query(Device).filter(Device.id == device_id).one_or_none()
    if device is None:
        return False
    _remember_deleted_known_device(db, device.name)
    db.delete(device)
    db.commit()
    return True
