from pydantic import BaseModel
from pydantic import Field


class DeviceSummary(BaseModel):
    id: int | None
    name: str
    device_type: str
    ip_address: str | None
    tailscale_name: str | None
    mac_address: str | None
    supports_wol: bool
    status: str
    description: str | None

    model_config = {"from_attributes": True}


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    device_type: str = Field(default="unknown", max_length=32)
    ip_address: str | None = Field(default=None, max_length=128)
    tailscale_name: str | None = Field(default=None, max_length=128)
    mac_address: str | None = Field(default=None, max_length=32)
    supports_wol: bool = False
    description: str | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    device_type: str | None = Field(default=None, max_length=32)
    ip_address: str | None = Field(default=None, max_length=128)
    tailscale_name: str | None = Field(default=None, max_length=128)
    mac_address: str | None = Field(default=None, max_length=32)
    supports_wol: bool | None = None
    description: str | None = None
