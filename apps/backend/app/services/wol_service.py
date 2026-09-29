from __future__ import annotations

import ipaddress
import re
import socket

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.device import Device
from app.services.control_agent_client import ControlAgentError, request_wake_on_lan

MAC_ADDRESS_PATTERN = re.compile(r"^[0-9A-Fa-f]{12}$")


def _send_magic_packet(mac_address: str, broadcast_address: str = "255.255.255.255") -> None:
    clean_mac = mac_address.replace(":", "").replace("-", "")
    if not MAC_ADDRESS_PATTERN.fullmatch(clean_mac):
        raise ValueError("Invalid MAC address")
    try:
        destination = str(ipaddress.IPv4Address(broadcast_address))
    except ipaddress.AddressValueError as exc:
        raise ValueError("Invalid IPv4 broadcast address") from exc
    if get_settings().wol_agent_url:
        request_wake_on_lan(mac_address, destination)
        return
    packet = bytes.fromhex("FF" * 6 + clean_mac * 16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(3):
            sock.sendto(packet, (destination, 9))


def wake_device(db: Session, device_id: int) -> None:
    device = db.query(Device).filter(Device.id == device_id).one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    if not device.supports_wol or not device.mac_address:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device does not support Wake-on-LAN")
    try:
        _send_magic_packet(device.mac_address, device.broadcast_address or "255.255.255.255")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except (ControlAgentError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Wake-on-LAN packet could not be sent"
        ) from exc
