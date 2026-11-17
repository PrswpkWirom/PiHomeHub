from pydantic import BaseModel


class PiStatus(BaseModel):
    hostname: str
    cpu_percent: float
    memory_percent: float | None
    disk_percent: float | None
    temperature_c: float | None
    uptime_seconds: int
    local_ip: str | None
    platform: str
    cpu_model: str | None = None
    cpu_logical_count: int | None = None
    memory_total_bytes: int | None = None
    memory_used_bytes: int | None = None
    memory_speed_mts: int | None = None
    disk_total_bytes: int | None = None
    disk_used_bytes: int | None = None
