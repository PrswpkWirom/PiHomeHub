from pydantic import BaseModel


class ServiceStatusRead(BaseModel):
    name: str
    slug: str
    status: str
    detail: str


class ServiceLinkRead(BaseModel):
    id: int
    name: str
    slug: str
    url: str
    description: str | None

    model_config = {"from_attributes": True}
