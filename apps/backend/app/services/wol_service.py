from __future__ import annotations

import socket

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.device import Device


def _send_magic_packet(mac_address: str) -> None:
    clean_mac = mac_address.replace(":", "").replace("-", "")
    if len(clean_mac) != 12:
        raise ValueError("Invalid MAC address")
    packet = bytes.fromhex("FF" * 6 + clean_mac * 16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, ("255.255.255.255", 9))


def wake_device(db: Session, device_id: int) -> None:
    device = db.query(Device).filter(Device.id == device_id).one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    if not device.supports_wol or not device.mac_address:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device does not support Wake-on-LAN")
    try:
        _send_magic_packet(device.mac_address)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
