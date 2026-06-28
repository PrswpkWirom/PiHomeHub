from pydantic import BaseModel


class PiStatus(BaseModel):
    hostname: str
    cpu_percent: float
    memory_percent: float
    disk_percent: float
    temperature_c: float | None
    uptime_seconds: int
    local_ip: str | None
    platform: str
