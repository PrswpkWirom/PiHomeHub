from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TailscaleStatus(BaseModel):
    token_saved: bool
    tailnet: str | None
    connected: bool
    last_sync_at: str | None
    last_sync_error: str | None


class TailscaleSettingsWrite(BaseModel):
    api_token: str | None = Field(default=None, min_length=1)
    tailnet: str = Field(min_length=1, max_length=255)


class TailscaleConnectionResult(BaseModel):
    ok: bool
    message: str


class CurrentTailscaleDevice(BaseModel):
    tailscale_id: str | None
    method: Literal["tailscale_ip", "lan_ip", "local_host", "unknown"]


class TailscaleDeviceRead(BaseModel):
    id: int
    tailscale_id: str
    node_id: str | None
    machine_name: str
    display_name: str
    hostname: str | None
    tailscale_ips: list[str]
    os: str | None
    online: bool
    last_seen: datetime | None
    tags: list[str]
    sync_status: str
    last_synced_at: datetime | None
    supports_wol: bool
    mac_address: str | None
    lan_ip_address: str | None
    broadcast_address: str | None
    alias: str | None
    note: str | None


class TailscaleWolUpdate(BaseModel):
    supports_wol: bool
    mac_address: str | None = Field(default=None, max_length=32)
    lan_ip_address: str | None = Field(default=None, max_length=128)
    broadcast_address: str | None = Field(default=None, max_length=128)
    alias: str | None = Field(default=None, max_length=128)
    note: str | None = None


class TailscaleDeviceSettingsUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=128)
    supports_wol: bool
    mac_address: str | None = Field(default=None, max_length=32)
    lan_ip_address: str | None = Field(default=None, max_length=128)
    broadcast_address: str | None = Field(default=None, max_length=128)
    note: str | None = None
