from __future__ import annotations

from collections import defaultdict, deque
from datetime import timedelta
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.account_security_service import AccountSecurityError, change_password_atomically
from app.core.security import (
    CSRF_HEADER_NAME,
    cleanup_expired_sessions,
    create_session,
    find_session,
    hash_password,
    password_needs_rehash,
    revoke_all_sessions,
    revoke_session,
    utc_now,
    verify_password,
)
from app.database.db import get_db
from app.models.user import SessionToken, User
from app.schemas.auth import AuthUser, ChangePasswordRequest, LoginRequest, PasswordRequest, SessionRead
from app.services.audit_service import record_audit_event
from app.services.auth_service import (
    get_current_session,
    require_authenticated_user,
    require_recent_authentication,
)

router = APIRouter(prefix="/auth", tags=["auth"])
_attempts: dict[tuple[str, str], deque] = defaultdict(deque)
_attempt_lock = Lock()
_dummy_hash: str | None = None


def _set_session_cookie(response: Response, raw_token: str, raw_csrf_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.cookie_name,
        value=raw_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.session_absolute_timeout_seconds,
        path="/",
    )
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=raw_csrf_token,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=settings.session_absolute_timeout_seconds,
        path="/",
    )


def _delete_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )
    response.delete_cookie(
        settings.csrf_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=False,
        samesite="strict",
    )


def _rate_limit_key(request: Request, username: str) -> tuple[str, str]:
    return (request.state.source_ip, username.strip().casefold())


def _is_rate_limited(key: tuple[str, str]) -> bool:
    settings = get_settings()
    cutoff = utc_now() - timedelta(seconds=settings.login_rate_limit_window_seconds)
    with _attempt_lock:
        limited = False
        for bucket_key in (key, (key[0], "*")):
            attempts = _attempts[bucket_key]
            while attempts and attempts[0] <= cutoff:
                attempts.popleft()
            limit = settings.login_rate_limit_attempts if bucket_key == key else settings.login_rate_limit_attempts * 5
            limited = limited or len(attempts) >= limit
        return limited


def _record_failure(key: tuple[str, str]) -> None:
    with _attempt_lock:
        _attempts[key].append(utc_now())
        _attempts[(key[0], "*")].append(utc_now())
        if len(_attempts) > 10_000:
            _attempts.clear()


def _clear_attempts(key: tuple[str, str]) -> None:
    with _attempt_lock:
        _attempts.pop(key, None)


@router.post("/login", response_model=AuthUser)
async def login(payload: LoginRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    global _dummy_hash
    username = payload.username.strip().casefold()
    key = _rate_limit_key(request, username)
    if _is_rate_limited(key):
        record_audit_event(db, event="login_failure", success=False, request=request, metadata={"reason": "rate_limited"})
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Invalid credentials")

    user = db.query(User).filter(User.username == username).one_or_none()
    if _dummy_hash is None:
        _dummy_hash = hash_password("Timing-only-password-42!")
    valid_password = verify_password(payload.password, user.password_hash if user else _dummy_hash)
    if not user or not user.is_active or not valid_password:
        _record_failure(key)
        record_audit_event(db, event="login_failure", success=False, request=request)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        user.password_changed_at = utc_now()
        db.commit()

    _clear_attempts(key)
    if existing_raw_token := request.cookies.get(get_settings().cookie_name):
        if existing_session := find_session(db, existing_raw_token):
            revoke_session(db, existing_session)
    cleanup_expired_sessions(db)
    session = create_session(
        db,
        user.id,
        user_agent=request.headers.get("user-agent"),
        source_ip=request.state.source_ip,
    )
    _set_session_cookie(response, session.token, session.csrf_token)
    response.headers[CSRF_HEADER_NAME] = session.csrf_token
    record_audit_event(db, event="login_success", success=True, request=request, actor_user_id=user.id)
    return AuthUser.model_validate(user)


@router.post("/logout")
async def logout(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    session: SessionToken = Depends(get_current_session),
    current_user: User = Depends(require_authenticated_user),
):
    revoke_session(db, session)
    _delete_session_cookie(response)
    record_audit_event(db, event="logout", success=True, request=request, actor_user_id=current_user.id)
    return {"status": "logged_out"}


@router.get("/me", response_model=AuthUser)
async def me(
    current_user: User = Depends(require_authenticated_user),
):
    return AuthUser.model_validate(current_user)


@router.get("/sessions", response_model=list[SessionRead])
async def list_sessions(
    db: Session = Depends(get_db),
    current: SessionToken = Depends(get_current_session),
    user: User = Depends(require_authenticated_user),
):
    cleanup_expired_sessions(db)
    rows = db.query(SessionToken).filter(SessionToken.user_id == user.id, SessionToken.revoked_at.is_(None)).all()
    return [
        SessionRead(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            authentication_time=row.authentication_time,
            user_agent=row.user_agent,
            source_ip=row.source_ip,
            current=row.id == current.id,
        )
        for row in rows
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: int,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    current: SessionToken = Depends(get_current_session),
    user: User = Depends(require_authenticated_user),
):
    target = db.query(SessionToken).filter(SessionToken.id == session_id, SessionToken.user_id == user.id).one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    revoke_session(db, target)
    if target.id == current.id:
        _delete_session_cookie(response)
    record_audit_event(
        db,
        event="session_revocation",
        success=True,
        request=request,
        actor_user_id=user.id,
        target_type="session",
        target_identifier=session_id,
    )


@router.post("/logout-all")
async def logout_all(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_recent_authentication),
):
    count = revoke_all_sessions(db, user.id)
    _delete_session_cookie(response)
    record_audit_event(db, event="session_revocation_all", success=True, request=request, actor_user_id=user.id)
    return {"status": "logged_out", "revoked": count}


@router.post("/reauthenticate")
async def reauthenticate(
    payload: PasswordRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    current: SessionToken = Depends(get_current_session),
    user: User = Depends(require_authenticated_user),
):
    if not verify_password(payload.password, user.password_hash):
        record_audit_event(db, event="reauthentication_failure", success=False, request=request, actor_user_id=user.id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    revoke_session(db, current)
    replacement = create_session(
        db,
        user.id,
        user_agent=request.headers.get("user-agent"),
        source_ip=request.state.source_ip,
    )
    _set_session_cookie(response, replacement.token, replacement.csrf_token)
    response.headers[CSRF_HEADER_NAME] = replacement.csrf_token
    record_audit_event(db, event="reauthentication_success", success=True, request=request, actor_user_id=user.id)
    return {"status": "reauthenticated"}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_recent_authentication),
    current: SessionToken = Depends(get_current_session),
):
    try:
        change_password_atomically(
            db,
            actor_user_id=user.id,
            current_session_id=current.id,
            current_password=payload.current_password,
            new_password=payload.new_password,
            request=request,
        )
    except AccountSecurityError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    _delete_session_cookie(response)
    return {"status": "password_changed"}
