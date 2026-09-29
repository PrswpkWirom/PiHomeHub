from datetime import datetime

from pydantic import BaseModel, Field, field_serializer

from app.core.security import as_utc


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=12, max_length=1024)


class AuthUser(BaseModel):
    id: int
    username: str
    is_admin: bool
    password_changed_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_serializer("password_changed_at")
    def serialize_password_changed_at(self, value: datetime | None) -> datetime | None:
        return as_utc(value) if value is not None else None


class SessionRead(BaseModel):
    id: int
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    authentication_time: datetime
    user_agent: str | None
    source_ip: str | None
    current: bool

    @field_serializer("created_at", "last_seen_at", "expires_at", "authentication_time")
    def serialize_datetime(self, value: datetime) -> datetime:
        return as_utc(value)
