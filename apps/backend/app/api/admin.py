from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.models.user import AuditEvent, User
from app.schemas.admin import (
    AdminUserRead,
    AuditEventPage,
    AuditEventRead,
    AuditEventSummary,
    UserSecurityUpdate,
)
from app.services.account_security_service import (
    AccountSecurityError,
    update_user_security_atomically,
)
from app.services.audit_service import record_audit_event
from app.services.auth_service import require_admin, require_recent_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[AdminUserRead])
async def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.username.asc(), User.id.asc()).all()


@router.get("/audit-events", response_model=list[AuditEventRead])
async def audit_events(limit: int = 100, db: Session = Depends(get_db)):
    bounded_limit = max(1, min(limit, 500))
    return db.query(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(bounded_limit).all()


@router.get("/audit-events/page", response_model=AuditEventPage)
async def audit_event_page(
    limit: int = Query(default=50, ge=1, le=100),
    before_id: int | None = Query(default=None, gt=0),
    category: Literal["all", "authentication", "users", "services", "system"] = "all",
    db: Session = Depends(get_db),
):
    query = db.query(AuditEvent, User.username).outerjoin(User, User.id == AuditEvent.actor_user_id)
    if before_id is not None:
        query = query.filter(AuditEvent.id < before_id)
    if category == "authentication":
        query = query.filter(AuditEvent.event.in_({
            "login_success", "login_failure", "logout", "reauthentication_success",
            "reauthentication_failure", "password_change", "session_revocation",
            "session_revocation_all", "recent_authentication_denied",
        }))
    elif category == "users":
        query = query.filter(AuditEvent.event == "user_security_change")
    elif category == "services":
        query = query.filter(AuditEvent.event.like("service\\_%", escape="\\"))
    elif category == "system":
        query = query.filter(
            ~AuditEvent.event.in_({
                "login_success", "login_failure", "logout", "reauthentication_success",
                "reauthentication_failure", "password_change", "session_revocation",
                "session_revocation_all", "recent_authentication_denied", "user_security_change",
            }),
            ~AuditEvent.event.like("service\\_%", escape="\\"),
        )

    rows = query.order_by(AuditEvent.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [
        AuditEventSummary(
            id=event.id,
            created_at=event.created_at,
            request_id=event.request_id,
            actor_user_id=event.actor_user_id,
            actor_username=username,
            event=event.event,
            target_type=event.target_type,
            target_identifier=event.target_identifier,
            success=event.success,
            source_ip=event.source_ip,
        )
        for event, username in rows
    ]
    return AuditEventPage(items=items, next_cursor=items[-1].id if has_more and items else None)


@router.patch(
    "/users/{user_id}",
    response_model=AdminUserRead,
    dependencies=[Depends(require_recent_admin)],
)
def update_user_security(
    user_id: int,
    payload: UserSecurityUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_recent_admin),
):
    session = getattr(request.state, "session", None)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        result = update_user_security_atomically(
            db,
            actor_user_id=actor.id,
            current_session_id=session.id,
            user_id=user_id,
            changes=payload.model_dump(exclude_none=True),
            request=request,
        )
    except AccountSecurityError as exc:
        if exc.audit_reason:
            record_audit_event(
                db,
                event="user_security_change",
                success=False,
                request=request,
                actor_user_id=actor.id,
                target_type="user",
                target_identifier=user_id,
                metadata={"reason": exc.audit_reason},
            )
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return AdminUserRead.model_validate(result.__dict__)
