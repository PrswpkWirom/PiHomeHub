from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

NotificationCategory = Literal["device", "service", "system", "security", "tailscale", "planner"]
NotificationSeverity = Literal["info", "success", "warning", "critical"]


class NotificationRead(BaseModel):
    id: int
    event_type: str
    category: NotificationCategory
    severity: NotificationSeverity
    title: str
    message: str
    source_type: str | None
    source_id: str | None
    target_path: str | None
    created_at: datetime
    resolved_at: datetime | None
    read_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class NotificationPage(BaseModel):
    items: list[NotificationRead]
    next_before_id: int | None


class NotificationPreferencesRead(BaseModel):
    device_offline: bool = True
    device_recovered: bool = True
    service_failure: bool = True
    service_recovered: bool = True
    temperature: bool = True
    disk: bool = True
    memory: bool = True
    monitoring: bool = True
    tailscale_sync: bool = True


class NotificationPreferencesUpdate(NotificationPreferencesRead):
    device_offline: bool | None = None
    device_recovered: bool | None = None
    service_failure: bool | None = None
    service_recovered: bool | None = None
    temperature: bool | None = None
    disk: bool | None = None
    memory: bool | None = None
    monitoring: bool | None = None
    tailscale_sync: bool | None = None


class ReadAllResult(BaseModel):
    updated: int = Field(ge=0)
