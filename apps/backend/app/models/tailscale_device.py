from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.db import Base


class TailscaleDevice(Base):
    __tablename__ = "tailscale_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tailscale_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    node_id: Mapped[str | None] = mapped_column(String(128))
    machine_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hostname: Mapped[str | None] = mapped_column(String(255))
    tailscale_ips: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    os: Mapped[str | None] = mapped_column(String(64))
    online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tags: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    sync_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    supports_wol: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mac_address: Mapped[str | None] = mapped_column(String(32))
    lan_ip_address: Mapped[str | None] = mapped_column(String(128))
    broadcast_address: Mapped[str | None] = mapped_column(String(128))
    alias: Mapped[str | None] = mapped_column(String(128))
    note: Mapped[str | None] = mapped_column(Text)
