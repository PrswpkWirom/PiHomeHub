from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.models.user import AuditEvent, User
from app.schemas.admin import AuditEventRead, UserSecurityUpdate
from app.schemas.auth import AuthUser
from app.services.audit_service import record_audit_event
from app.services.auth_service import require_admin, require_recent_admin
from app.core.security import revoke_all_sessions

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/audit-events", response_model=list[AuditEventRead])
async def audit_events(limit: int = 100, db: Session = Depends(get_db)):
    bounded_limit = max(1, min(limit, 500))
    return db.query(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(bounded_limit).all()


@router.patch(
    "/users/{user_id}",
    response_model=AuthUser,
    dependencies=[Depends(require_recent_admin)],
)
async def update_user_security(
    user_id: int,
    payload: UserSecurityUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_recent_admin),
):
    target = db.query(User).filter(User.id == user_id).one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    changes = payload.model_dump(exclude_none=True)
    if target.id == actor.id and changes.get("is_active") is False:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Administrators cannot disable their own account")
    if target.id == actor.id and changes.get("is_admin") is False:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Administrators cannot remove their own role")
    changed = any(getattr(target, key) != value for key, value in changes.items())
    for key, value in changes.items():
        setattr(target, key, value)
    db.commit()
    db.refresh(target)
    if changed:
        revoke_all_sessions(db, target.id)
    record_audit_event(
        db,
        event="user_security_change",
        success=True,
        request=request,
        actor_user_id=actor.id,
        target_type="user",
        target_identifier=target.id,
        metadata=changes,
    )
    return AuthUser.model_validate(target)
