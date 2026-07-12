from datetime import timedelta

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import as_utc, find_session, session_is_valid, touch_session, utc_now
from app.database.db import get_db
from app.models.user import SessionToken, User
from app.services.audit_service import record_audit_event


async def get_current_session(
    request: Request,
    db: Session = Depends(get_db),
) -> SessionToken:
    raw_token = request.cookies.get(get_settings().cookie_name)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session = find_session(db, raw_token)
    if session is None or not session_is_valid(session):
        if session is not None and session.revoked_at is None:
            session.revoked_at = utc_now()
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    touch_session(db, session)
    request.state.session = session
    return session


async def require_authenticated_user(
    request: Request,
    session: SessionToken = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> User:
    user = db.query(User).filter(User.id == session.user_id).one_or_none()
    if user is None or not user.is_active:
        if session.revoked_at is None:
            session.revoked_at = utc_now()
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    request.state.current_user = user
    return user


get_current_user = require_authenticated_user


async def require_admin(
    request: Request,
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
) -> User:
    if not user.is_admin:
        record_audit_event(
            db,
            event="authorization_denied",
            success=False,
            request=request,
            actor_user_id=user.id,
            metadata={"path": request.url.path, "required_role": "admin"},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


async def require_recent_authentication(
    request: Request,
    session: SessionToken = Depends(get_current_session),
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
) -> User:
    window = timedelta(seconds=get_settings().recent_authentication_seconds)
    if as_utc(session.authentication_time) + window <= utc_now():
        record_audit_event(
            db,
            event="recent_authentication_denied",
            success=False,
            request=request,
            actor_user_id=user.id,
            metadata={"path": request.url.path},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent authentication required")
    return user


async def require_recent_admin(
    request: Request,
    session: SessionToken = Depends(get_current_session),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    window = timedelta(seconds=get_settings().recent_authentication_seconds)
    if as_utc(session.authentication_time) + window <= utc_now():
        record_audit_event(
            db,
            event="recent_authentication_denied",
            success=False,
            request=request,
            actor_user_id=user.id,
            metadata={"path": request.url.path},
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent authentication required")
    return user
