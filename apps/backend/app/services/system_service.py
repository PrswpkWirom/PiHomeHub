from __future__ import annotations

import os
import platform
import socket
import time
from pathlib import Path

import psutil

from app.core.config import get_settings
from app.schemas.system import PiStatus


def _read_temperature() -> float | None:
    path = get_settings().host_thermal_path
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return round(int(handle.read().strip()) / 1000, 1)
        except (OSError, ValueError):
            return None
    return None


def _read_host_memory_percent() -> float | None:
    try:
        values: dict[str, int] = {}
        for line in Path(get_settings().host_meminfo_path).read_text(encoding="ascii").splitlines():
            key, raw = line.split(":", 1)
            if key in {"MemTotal", "MemAvailable"}:
                values[key] = int(raw.strip().split()[0])
        total, available = values["MemTotal"], values["MemAvailable"]
        return round((total - available) * 100 / total, 1) if total else None
    except (OSError, ValueError, KeyError, IndexError):
        return None


def _local_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


def get_pi_status() -> PiStatus:
    boot_time = psutil.boot_time()
    uptime_seconds = int(time.time() - boot_time)
    try:
        disk_percent = psutil.disk_usage(get_settings().host_root_probe_path).percent
    except OSError:
        disk_percent = None

    return PiStatus(
        hostname=socket.gethostname(),
        cpu_percent=psutil.cpu_percent(interval=0.1),
        memory_percent=_read_host_memory_percent(),
        disk_percent=disk_percent,
        temperature_c=_read_temperature(),
        uptime_seconds=uptime_seconds,
        local_ip=_local_ip(),
        platform=platform.platform(),
    )
