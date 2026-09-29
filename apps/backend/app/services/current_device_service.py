"""Identify the viewing device from exact addresses, never names or user agents."""
from __future__ import annotations

import json
import socket
from ipaddress import IPv4Address, IPv6Address, ip_address
from pathlib import Path

import psutil

from app.core.config import get_settings
from app.models.tailscale_device import TailscaleDevice
from app.schemas.tailscale import CurrentTailscaleDevice


def normalized_ip(value: str | None) -> IPv4Address | IPv6Address | None:
    try:
        parsed = ip_address((value or "").split("%", 1)[0])
        if isinstance(parsed, IPv6Address) and parsed.ipv4_mapped:
            return parsed.ipv4_mapped
        return parsed
    except ValueError:
        return None


def local_interface_addresses() -> set[IPv4Address | IPv6Address]:
    try:
        return {
            parsed
            for addresses in psutil.net_if_addrs().values()
            for address in addresses
            if address.family in {socket.AF_INET, socket.AF_INET6}
            if (parsed := normalized_ip(address.address)) is not None and not parsed.is_loopback
        }
    except (OSError, psutil.Error):
        return set()


def identify_current_device(
    devices: list[TailscaleDevice], source_ip: str, *, local_access: bool = False
) -> CurrentTailscaleDevice:
    source = normalized_ip(source_ip)
    unknown = CurrentTailscaleDevice(tailscale_id=None, method="unknown")
    if source is None or source.is_unspecified or source.is_multicast:
        return unknown

    # One linear pass builds the candidates. Duplicate/stale records cannot win.
    active = [device for device in devices if device.sync_status == "active"]
    addresses: dict[str, set[IPv4Address | IPv6Address]] = {}
    for device in active:
        try:
            raw_addresses = json.loads(device.tailscale_ips or "[]")
        except (ValueError, TypeError):
            raw_addresses = []
        addresses[device.tailscale_id] = {
            parsed for value in raw_addresses if isinstance(value, str)
            if (parsed := normalized_ip(value)) is not None
        } if isinstance(raw_addresses, list) else set()

    matches = [device for device in active if source in addresses[device.tailscale_id]]
    method = "tailscale_ip"
    if not matches and source.is_private and not source.is_loopback:
        matches = [device for device in active if normalized_ip(device.lan_ip_address) == source]
        method = "lan_ip"

    # Only a direct development host can infer itself from local interfaces.
    # Docker/Serve loopback belongs to a proxy, not necessarily the browser.
    if not matches and get_settings().env == "development" and not Path("/.dockerenv").exists():
        interfaces = local_interface_addresses()
        if (source.is_loopback and local_access) or source in interfaces:
            matches = [device for device in active if addresses[device.tailscale_id] & interfaces]
            method = "local_host"
    if len(matches) != 1:
        return unknown
    return CurrentTailscaleDevice(tailscale_id=matches[0].tailscale_id, method=method)
