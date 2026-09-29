from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database.db import get_db
from app.models.notification import Notification, NotificationRecipient
from app.models.user import User
from app.schemas.notifications import (
    NotificationPage, NotificationPreferencesRead, NotificationPreferencesUpdate,
    NotificationRead, ReadAllResult,
)
from app.services.auth_service import get_current_user
from app.services.notification_service import get_preferences, mark_all_read, mark_read, save_preferences, unread_count

router = APIRouter(prefix="/notifications", tags=["notifications"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=NotificationPage)
def list_notifications(
    limit: int = Query(default=30, ge=1, le=100),
    before_id: int | None = Query(default=None, gt=0),
    unread: bool | None = None,
    severity: Literal["info", "success", "warning", "critical"] | None = None,
    category: Literal["device", "service", "system", "security", "tailscale", "planner"] | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Notification, NotificationRecipient.read_at).join(
        NotificationRecipient, NotificationRecipient.notification_id == Notification.id
    ).filter(NotificationRecipient.user_id == user.id)
    if before_id is not None:
        query = query.filter(Notification.id < before_id)
    if unread is not None:
        query = query.filter(NotificationRecipient.read_at.is_(None) if unread else NotificationRecipient.read_at.is_not(None))
    if severity:
        query = query.filter(Notification.severity == severity)
    if category:
        query = query.filter(Notification.category == category)
    rows = query.order_by(Notification.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [NotificationRead.model_validate({**row.__dict__, "read_at": read_at}) for row, read_at in rows]
    return NotificationPage(items=items, next_before_id=items[-1].id if has_more and items else None)


@router.get("/unread-count")
def notifications_unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"count": unread_count(db, user.id)}


@router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def notification_read(notification_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not mark_read(db, user.id, notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")


@router.post("/read-all", response_model=ReadAllResult)
def notifications_read_all(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return ReadAllResult(updated=mark_all_read(db, user.id))


@router.get("/preferences", response_model=NotificationPreferencesRead)
def notification_preferences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_preferences(db, user.id)


@router.patch("/preferences", response_model=NotificationPreferencesRead)
def update_notification_preferences(
    payload: NotificationPreferencesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return save_preferences(db, user.id, payload.model_dump(exclude_none=True))
