from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_serializer

from app.core.security import as_utc


class UserSecurityUpdate(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None
    model_config = ConfigDict(extra="forbid")


class AdminUserRead(BaseModel):
    id: int
    username: str
    is_admin: bool
    is_active: bool

    model_config = {"from_attributes": True}


class AuditEventSummary(BaseModel):
    id: int
    created_at: datetime
    request_id: str | None
    actor_user_id: int | None
    actor_username: str | None
    event: str
    target_type: str | None
    target_identifier: str | None
    success: bool
    source_ip: str | None

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> datetime:
        return as_utc(value)


class AuditEventPage(BaseModel):
    items: list[AuditEventSummary]
    next_cursor: int | None


class AuditEventRead(BaseModel):
    id: int
    created_at: datetime
    request_id: str | None
    actor_user_id: int | None
    event: str
    target_type: str | None
    target_identifier: str | None
    success: bool
    source_ip: str | None
    metadata_json: str

    model_config = {"from_attributes": True}

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> datetime:
        return as_utc(value)
