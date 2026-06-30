from pydantic import BaseModel


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


class ServiceLinkRead(BaseModel):
    id: int
    name: str
    slug: str
    url: str
    description: str | None

    model_config = {"from_attributes": True}
