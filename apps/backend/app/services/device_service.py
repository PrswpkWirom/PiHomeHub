from __future__ import annotations

import platform
import socket
import subprocess

from sqlalchemy.orm import Session

from app.models.device import Device
from app.schemas.devices import DeviceSummary


def _ping_host(host: str | None) -> str:
    if not host:
        return "unknown"
    result = subprocess.run(
        ["ping", "-c", "1", "-W", "1", host],
        capture_output=True,
        text=True,
        check=False,
        timeout=3,
    )
    return "online" if result.returncode == 0 else "offline"


def get_devices(db: Session) -> list[DeviceSummary]:
    items = [
        DeviceSummary(
            id=None,
            name=socket.gethostname(),
            device_type="raspberry-pi" if "Linux" in platform.system() else "server",
            ip_address=None,
            tailscale_name=None,
            mac_address=None,
            supports_wol=False,
            status="online",
            description="Local PiHomeHub host",
        )
    ]
    for device in db.query(Device).order_by(Device.name.asc()).all():
        items.append(
            DeviceSummary(
                id=device.id,
                name=device.name,
                device_type=device.device_type,
                ip_address=device.ip_address,
                tailscale_name=device.tailscale_name,
                mac_address=device.mac_address,
                supports_wol=device.supports_wol,
                status=_ping_host(device.ip_address or device.tailscale_name),
                description=device.description,
            )
        )
    return items
