from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.notification import Notification, NotificationPreference, NotificationRecipient
from app.models.user import User
from app.schemas.notifications import NotificationPreferencesRead

PREFERENCE_FOR_EVENT = {
    "device_offline": "device_offline",
    "device_recovered": "device_recovered",
    "service_failure": "service_failure",
    "service_action_failed": "service_failure",
    "service_action_completed": "service_recovered",
    "service_recovered": "service_recovered",
    "temperature_high": "temperature",
    "temperature_recovered": "temperature",
    "disk_high": "disk",
    "disk_critical": "disk",
    "disk_degraded": "disk",
    "disk_recovered": "disk",
    "memory_high": "memory",
    "memory_recovered": "memory",
    "monitoring_unavailable": "monitoring",
    "monitoring_recovered": "monitoring",
    "tailscale_sync_failed": "tailscale_sync",
    "tailscale_sync_recovered": "tailscale_sync",
}
ALLOWED_TARGETS = {"/devices", "/services", "/settings/system", "/settings/access"}
ALLOWED_METADATA = {"temperature_c", "usage_percent", "duration_minutes", "last_success_at", "service_status"}
SENSITIVE_ASSIGNMENT = re.compile(r"(?i)\b(password|passwd|token|api[_-]?key|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+")
SENSITIVE_HEADER = re.compile(r"(?i)\b(authorization|cookie)\s*[:=]\s*[^\r\n]+")
BEARER_VALUE = re.compile(r"(?i)\bbearer\s+[^\s,;]+")


def _safe_text(value: str, limit: int) -> str:
    text = SENSITIVE_HEADER.sub(lambda match: f"{match.group(1)}=[redacted]", value)
    text = BEARER_VALUE.sub("Bearer [redacted]", text)
    text = SENSITIVE_ASSIGNMENT.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    return "".join(character for character in text if character in "\n\t" or ord(character) >= 32)[:limit]


def _safe_metadata(metadata: dict[str, Any] | None) -> str:
    clean: dict[str, str | int | float | bool | None] = {}
    for key, value in (metadata or {}).items():
        if key not in ALLOWED_METADATA:
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            clean[key] = value if not isinstance(value, str) else value[:128]
    return json.dumps(clean, sort_keys=True, separators=(",", ":"))[:1024]


def create_notification(
    db: Session,
    *,
    event_key: str,
    event_type: str,
    category: str,
    severity: str,
    title: str,
    message: str,
    source_type: str | None = None,
    source_id: str | int | None = None,
    target_path: str | None = None,
    metadata: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> Notification | None:
    """Persist one bounded, deduplicated event and its per-user deliveries."""
    if db.query(Notification.id).filter(Notification.event_key == event_key[:255]).first():
        return None
    if target_path not in ALLOWED_TARGETS:
        target_path = None
    row = Notification(
        event_key=event_key[:255], event_type=event_type[:64], category=category,
        severity=severity, title=_safe_text(title, 160), message=_safe_text(message, 512),
        source_type=source_type[:32] if source_type else None,
        source_id=str(source_id)[:128] if source_id is not None else None,
        target_path=target_path, created_at=created_at or datetime.now(UTC),
        metadata_json=_safe_metadata(metadata),
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
            preference_field = PREFERENCE_FOR_EVENT.get(event_type)
            active_users = [item[0] for item in db.query(User.id).filter(User.is_active.is_(True)).all()]
            preferences = {
                pref.user_id: getattr(pref, preference_field) if preference_field else True
                for pref in db.query(NotificationPreference).filter(NotificationPreference.user_id.in_(active_users)).all()
            } if active_users else {}
            db.add_all([
                NotificationRecipient(notification_id=row.id, user_id=user_id)
                for user_id in active_users if preferences.get(user_id, True)
            ])
            db.flush()
    except IntegrityError:
        # A concurrent producer won the unique event key; keep this outer
        # transaction usable and suppress the duplicate delivery.
        return None
    return row


def resolve_incident(db: Session, event_key: str, at: datetime | None = None) -> bool:
    row = db.query(Notification).filter(Notification.event_key == event_key).one_or_none()
    if row is None or row.resolved_at is not None:
        return False
    row.resolved_at = at or datetime.now(UTC)
    db.flush()
    return True


def get_preferences(db: Session, user_id: int) -> NotificationPreferencesRead:
    row = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).one_or_none()
    if row is None:
        return NotificationPreferencesRead()
    return NotificationPreferencesRead.model_validate(row, from_attributes=True)


def save_preferences(db: Session, user_id: int, values: dict[str, bool]) -> NotificationPreferencesRead:
    values = {key: value for key, value in values.items() if value is not None}
    row = db.query(NotificationPreference).filter(NotificationPreference.user_id == user_id).one_or_none()
    if row is None:
        row = NotificationPreference(user_id=user_id)
        db.add(row)
    for key, value in values.items():
        setattr(row, key, value)
    db.commit()
    return get_preferences(db, user_id)


def unread_count(db: Session, user_id: int) -> int:
    return int(db.query(func.count(NotificationRecipient.id)).filter(
        NotificationRecipient.user_id == user_id, NotificationRecipient.read_at.is_(None)
    ).scalar() or 0)


def mark_read(db: Session, user_id: int, notification_id: int) -> bool:
    row = db.query(NotificationRecipient).filter(
        NotificationRecipient.user_id == user_id,
        NotificationRecipient.notification_id == notification_id,
    ).one_or_none()
    if row is None:
        return False
    if row.read_at is None:
        row.read_at = datetime.now(UTC)
        db.commit()
    return True


def mark_all_read(db: Session, user_id: int) -> int:
    boundary = db.query(func.max(NotificationRecipient.notification_id)).filter(
        NotificationRecipient.user_id == user_id
    ).scalar()
    if boundary is None:
        return 0
    now = datetime.now(UTC)
    updated = db.query(NotificationRecipient).filter(
        NotificationRecipient.user_id == user_id,
        NotificationRecipient.notification_id <= boundary,
        NotificationRecipient.read_at.is_(None),
    ).update({"read_at": now}, synchronize_session=False)
    db.commit()
    return int(updated)
