from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from fastapi import Request
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.security import (
    as_utc,
    hash_password,
    revoke_all_sessions,
    session_is_valid,
    utc_now,
    verify_password,
)
from app.models.user import SessionToken, User
from app.services.audit_service import record_audit_event


@dataclass
class AccountSecurityError(Exception):
    status_code: int
    detail: str
    audit_reason: str | None = None


def _open_write_transaction(db: Session) -> Session:
    """Start a fresh, bounded SQLite write transaction before any policy reads."""
    bind = db.get_bind()
    factory = sessionmaker(bind=bind, autoflush=False, expire_on_commit=False)
    transaction = factory()
    try:
        connection = transaction.connection()
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA busy_timeout = 5000")
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        return transaction
    except OperationalError as exc:
        transaction.rollback()
        transaction.close()
        if _is_lock_error(exc):
            raise AccountSecurityError(503, "The account security update is busy. Please retry shortly.") from exc
        raise
    except Exception:
        transaction.rollback()
        transaction.close()
        raise


def _is_lock_error(error: OperationalError) -> bool:
    return "locked" in str(error).lower() or "busy" in str(error).lower()


def _active_admin_count(db: Session) -> int:
    return db.query(User).filter(User.is_admin.is_(True), User.is_active.is_(True)).count()


def update_user_security_atomically(
    db: Session,
    *,
    actor_user_id: int,
    current_session_id: int,
    user_id: int,
    changes: dict[str, bool],
    request: Request,
) -> AdminUserSnapshot:
    transaction = _open_write_transaction(db)
    try:
        session = transaction.query(SessionToken).filter(
            SessionToken.id == current_session_id,
            SessionToken.user_id == actor_user_id,
        ).one_or_none()
        actor = transaction.query(User).filter(User.id == actor_user_id).one_or_none()
        if session is None or not session_is_valid(session):
            raise AccountSecurityError(401, "Invalid or expired session", "actor_session_invalid")
        if actor is None or not actor.is_active:
            raise AccountSecurityError(401, "Invalid session", "actor_inactive")
        if not actor.is_admin:
            raise AccountSecurityError(403, "Administrator access required", "actor_not_admin")
        recent_window = timedelta(seconds=get_settings().recent_authentication_seconds)
        if as_utc(session.authentication_time) + recent_window <= utc_now():
            raise AccountSecurityError(403, "Recent authentication required", "recent_authentication_expired")

        target = transaction.query(User).filter(User.id == user_id).one_or_none()
        if target is None:
            raise AccountSecurityError(404, "User not found")
        if target.id == actor.id and changes.get("is_active") is False:
            raise AccountSecurityError(409, "Administrators cannot disable their own account", "self_disable")
        if target.id == actor.id and changes.get("is_admin") is False:
            raise AccountSecurityError(409, "Administrators cannot remove their own role", "self_demote")

        changed = any(getattr(target, key) != value for key, value in changes.items())
        was_active_admin = target.is_admin and target.is_active
        will_be_active_admin = changes.get("is_admin", target.is_admin) and changes.get("is_active", target.is_active)
        resulting_admin_count = _active_admin_count(transaction) - int(was_active_admin) + int(will_be_active_admin)
        if resulting_admin_count < 1:
            raise AccountSecurityError(409, "At least one active administrator must remain", "last_active_admin")

        for key, value in changes.items():
            setattr(target, key, value)
        if changed:
            revoke_all_sessions(transaction, target.id, commit=False)
        record_audit_event(
            transaction,
            event="user_security_change",
            success=True,
            request=request,
            actor_user_id=actor.id,
            target_type="user",
            target_identifier=target.id,
            metadata=changes,
            commit=False,
        )
        transaction.flush()
        result = AdminUserSnapshot(target.id, target.username, target.is_admin, target.is_active)
        transaction.commit()
        return result
    except AccountSecurityError:
        transaction.rollback()
        raise
    except OperationalError as exc:
        transaction.rollback()
        if _is_lock_error(exc):
            raise AccountSecurityError(503, "The account update is busy. Please retry shortly.") from exc
        raise
    except Exception:
        transaction.rollback()
        raise
    finally:
        transaction.close()


@dataclass(frozen=True)
class AdminUserSnapshot:
    id: int
    username: str
    is_admin: bool
    is_active: bool


@dataclass(frozen=True)
class PasswordChangeResult:
    username: str


def change_password_atomically(
    db: Session,
    *,
    actor_user_id: int,
    current_session_id: int,
    current_password: str,
    new_password: str,
    request: Request,
) -> PasswordChangeResult:
    transaction = _open_write_transaction(db)
    try:
        session = transaction.query(SessionToken).filter(
            SessionToken.id == current_session_id,
            SessionToken.user_id == actor_user_id,
        ).one_or_none()
        user = transaction.query(User).filter(User.id == actor_user_id).one_or_none()
        if session is None or not session_is_valid(session):
            raise AccountSecurityError(401, "Invalid or expired session", "actor_session_invalid")
        if user is None or not user.is_active:
            raise AccountSecurityError(401, "Invalid session", "actor_inactive")
        recent_window = timedelta(seconds=get_settings().recent_authentication_seconds)
        if as_utc(session.authentication_time) + recent_window <= utc_now():
            raise AccountSecurityError(403, "Recent authentication required", "recent_authentication_expired")
        if not verify_password(current_password, user.password_hash):
            raise AccountSecurityError(401, "Invalid credentials", "invalid_current_password")
        try:
            user.password_hash = hash_password(new_password)
        except ValueError as exc:
            raise AccountSecurityError(422, str(exc), "password_policy_rejected") from exc
        user.password_changed_at = utc_now()
        revoke_all_sessions(transaction, user.id, commit=False)
        record_audit_event(
            transaction,
            event="password_change",
            success=True,
            request=request,
            actor_user_id=user.id,
            commit=False,
        )
        transaction.flush()
        result = PasswordChangeResult(user.username)
        transaction.commit()
        return result
    except AccountSecurityError as exc:
        transaction.rollback()
        if exc.audit_reason:
            record_audit_event(
                db,
                event="password_change",
                success=False,
                request=request,
                actor_user_id=actor_user_id,
                metadata={"reason": exc.audit_reason},
            )
        raise
    except OperationalError as exc:
        transaction.rollback()
        if _is_lock_error(exc):
            raise AccountSecurityError(503, "The password update is busy. Please retry shortly.") from exc
        raise
    except Exception:
        transaction.rollback()
        raise
    finally:
        transaction.close()
