from datetime import datetime

from pydantic import BaseModel


class UserSecurityUpdate(BaseModel):
    is_admin: bool | None = None
    is_active: bool | None = None


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
