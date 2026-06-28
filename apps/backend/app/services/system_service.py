from __future__ import annotations

import os
import platform
import socket
import time

import psutil

from app.schemas.system import PiStatus


def _read_temperature() -> float | None:
    path = "/sys/class/thermal/thermal_zone0/temp"
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return round(int(handle.read().strip()) / 1000, 1)
        except (OSError, ValueError):
            return None
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
    disk = psutil.disk_usage("/")

    return PiStatus(
        hostname=socket.gethostname(),
        cpu_percent=psutil.cpu_percent(interval=0.1),
        memory_percent=psutil.virtual_memory().percent,
        disk_percent=disk.percent,
        temperature_c=_read_temperature(),
        uptime_seconds=uptime_seconds,
        local_ip=_local_ip(),
        platform=platform.platform(),
    )
