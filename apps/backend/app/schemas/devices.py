from pydantic import BaseModel


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
