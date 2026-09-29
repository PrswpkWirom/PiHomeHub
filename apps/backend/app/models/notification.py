from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(String(512), nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(32))
    source_id: Mapped[str | None] = mapped_column(String(128))
    target_path: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)

    __table_args__ = (Index("ix_notifications_created_at", "created_at", "id"),)


class NotificationRecipient(Base):
    __tablename__ = "notification_recipients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", name="uq_notification_recipient"),
        Index("ix_notification_recipients_user_read", "user_id", "read_at", "notification_id"),
    )


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    device_offline: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    device_recovered: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    service_failure: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    service_recovered: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    temperature: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    disk: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    memory: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    monitoring: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    tailscale_sync: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class MonitorState(Base):
    __tablename__ = "notification_monitor_state"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
