from __future__ import annotations

import json
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


def _read_host_memory() -> tuple[float | None, int | None, int | None]:
    try:
        values: dict[str, int] = {}
        for line in Path(get_settings().host_meminfo_path).read_text(encoding="ascii").splitlines():
            key, raw = line.split(":", 1)
            if key in {"MemTotal", "MemAvailable"}:
                values[key] = int(raw.strip().split()[0])
        total, available = values["MemTotal"], values["MemAvailable"]
        if total <= 0 or not 0 <= available <= total:
            return None, None, None
        used = total - available
        return round(used * 100 / total, 1), total * 1024, used * 1024
    except (OSError, ValueError, KeyError, IndexError, UnicodeError):
        return None, None, None


def _read_cpu_model() -> str | None:
    try:
        entries = [line.partition(":") for line in Path(get_settings().host_cpuinfo_path).read_text().splitlines()]
        # x86 model name; ARM/Raspberry Pi model; then ARM's processor description.
        for name in ("model name", "Model", "Processor", "Hardware"):
            for key, separator, value in entries:
                if separator and key.strip() == name and value.strip():
                    return value.strip()
    except (OSError, UnicodeError):
        pass
    return None


def _read_memory_speed() -> int | None:
    path = get_settings().host_hardware_file
    if not path:
        return None
    try:
        snapshot = json.loads(Path(path).read_text())
        speed = snapshot.get("memory_speed_mts") if isinstance(snapshot, dict) else None
        return speed if type(speed) is int and 0 < speed <= 100_000 else None
    except (OSError, ValueError, UnicodeError):
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
    memory_percent, memory_total, memory_used = _read_host_memory()
    try:
        disk = psutil.disk_usage(get_settings().host_root_probe_path)
    except OSError:
        disk = None

    return PiStatus(
        hostname=socket.gethostname(),
        cpu_percent=psutil.cpu_percent(interval=0.1),
        memory_percent=memory_percent,
        disk_percent=disk.percent if disk else None,
        temperature_c=_read_temperature(),
        uptime_seconds=uptime_seconds,
        local_ip=_local_ip(),
        platform=platform.platform(),
        cpu_model=_read_cpu_model(),
        cpu_logical_count=psutil.cpu_count(),
        memory_total_bytes=memory_total,
        memory_used_bytes=memory_used,
        memory_speed_mts=_read_memory_speed(),
        disk_total_bytes=disk.total if disk else None,
        disk_used_bytes=disk.used if disk else None,
    )
