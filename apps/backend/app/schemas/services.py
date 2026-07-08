from pydantic import BaseModel, StrictInt


class ServiceStatusRead(BaseModel):
    name: str
    slug: str
    status: str
    detail: str


class ServiceCapabilityRead(BaseModel):
    slug: str
    actions: list[str]


class ServiceActionResult(BaseModel):
    slug: str
    action: str
    ok: bool
    message: str


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
    ports: list[ServicePortRead]


class ServicePortConfigUpdate(BaseModel):
    ports: dict[str, StrictInt]


class ServiceLinkRead(BaseModel):
    id: int
    name: str
    slug: str
    url: str
    description: str | None

    model_config = {"from_attributes": True}
