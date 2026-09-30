from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, StrictInt, HttpUrl, TypeAdapter, field_validator



class ServiceStatusRead(BaseModel):
    name: str
    slug: str
    status: str
    health_status: str | None = None
    detail: str
    host_ip: str | None = None
    host_ports: dict[str, int] = Field(default_factory=dict)
    url: str | None = None
    setup_required: bool = False
    operation: ServiceOperationRead | None = None
    recent_operations: list[ServiceOperationRead] = Field(default_factory=list)


class ServiceOperationRead(BaseModel):
    operation_id: str
    slug: str
    action: str
    state: Literal["queued", "running", "verifying", "succeeded", "failed", "unknown"]
    stage: str
    created_at: str
    updated_at: str
    finished_at: str | None = None
    error_code: str | None = None
    message: str | None = None


class ServiceActionRequest(BaseModel):
    operation_id: str


class ServiceCapabilityRead(BaseModel):
    slug: str
    actions: list[str]
    setup_required: bool = False


class ServiceActionResult(BaseModel):
    slug: str
    action: str
    ok: bool
    message: str
    operation: ServiceOperationRead | None = None


class ServicePortRead(BaseModel):
    key: str
    label: str
    env_var: str
    container_port: int
    protocols: list[str]
    default_host_port: int
    desired_host_port: int
    running_host_ports: dict[str, int | None]
    pending: bool


class ServicePortConfigRead(BaseModel):
    slug: str
    name: str
    status: str
    detail: str
    has_pending_port_change: bool
    deployment_mode: Literal["operator"]
    configuration_mode: Literal["web", "operator"]
    bindings_verified: bool
    operator_command: str
    host_ip: str | None = None
    ports: list[ServicePortRead]


class ServicePortConfigUpdate(BaseModel):
    ports: dict[str, StrictInt]


class ServiceLinkWrite(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    url: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("name", "url", "description", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = TypeAdapter(HttpUrl).validate_python(value)
        if parsed.username or parsed.password:
            raise ValueError("Use a URL without embedded credentials")
        return value


class ServiceLinkRead(BaseModel):
    id: int
    url_override: bool = False
    name: str
    slug: str
    url: str
    description: str | None

    model_config = {"from_attributes": True}
