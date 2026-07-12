from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.user import AuditEvent

SENSITIVE_KEYS = {"password", "token", "csrf", "cookie", "authorization", "api_key", "secret"}


def sanitize_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        lowered = key.lower()
        if any(sensitive in lowered for sensitive in SENSITIVE_KEYS):
            clean[key] = "[REDACTED]"
        elif isinstance(value, (str, int, float, bool)) or value is None:
            clean[key] = value if not isinstance(value, str) else value[:256]
    return clean


def record_audit_event(
    db: Session,
    *,
    event: str,
    success: bool,
    request: Request | None = None,
    actor_user_id: int | None = None,
    target_type: str | None = None,
    target_identifier: str | int | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    row = AuditEvent(
        request_id=getattr(request.state, "request_id", None) if request else None,
        actor_user_id=actor_user_id,
        event=event,
        target_type=target_type,
        target_identifier=str(target_identifier)[:128] if target_identifier is not None else None,
        success=success,
        source_ip=getattr(request.state, "source_ip", None) if request else None,
        metadata_json=json.dumps(sanitize_metadata(metadata), sort_keys=True),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
