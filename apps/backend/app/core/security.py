from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import SessionToken

CSRF_HEADER_NAME = "X-CSRF-Token"
password_hasher = PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=2)
legacy_password_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


@dataclass(frozen=True)
class CreatedSession:
    record: SessionToken
    token: str
    csrf_token: str


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    validate_password_strength(password)
    return password_hasher.hash(password)


def validate_password_strength(password: str) -> None:
    defaults = {"admin", "password", "change-me", "change-me-now", "test-secret"}
    if len(password) < 12 or password.lower() in defaults:
        raise ValueError("Password must be at least 12 characters and must not be a known default")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except InvalidHashError:
        try:
            return legacy_password_context.verify(password, password_hash)
        except (ValueError, TypeError):
            return False


def password_needs_rehash(password_hash: str) -> bool:
    return not password_hash.startswith("$argon2id$") or password_hasher.check_needs_rehash(password_hash)


def create_session(
    db: Session,
    user_id: int,
    *,
    user_agent: str | None = None,
    source_ip: str | None = None,
    authentication_time: datetime | None = None,
) -> CreatedSession:
    settings = get_settings()
    now = utc_now()
    raw_token = secrets.token_urlsafe(48)
    raw_csrf_token = secrets.token_urlsafe(32)
    record = SessionToken(
        user_id=user_id,
        token_hash=hash_token(raw_token),
        csrf_token_hash=hash_token(raw_csrf_token),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(seconds=settings.session_absolute_timeout_seconds),
        authentication_time=authentication_time or now,
        user_agent=(user_agent or "")[:255] or None,
        source_ip=source_ip,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return CreatedSession(record=record, token=raw_token, csrf_token=raw_csrf_token)


def find_session(db: Session, raw_token: str) -> SessionToken | None:
    return db.query(SessionToken).filter(SessionToken.token_hash == hash_token(raw_token)).one_or_none()


def session_is_valid(session: SessionToken, now: datetime | None = None) -> bool:
    settings = get_settings()
    current = now or utc_now()
    if session.revoked_at is not None:
        return False
    if as_utc(session.expires_at) <= current:
        return False
    return as_utc(session.last_seen_at) + timedelta(seconds=settings.session_idle_timeout_seconds) > current


def touch_session(db: Session, session: SessionToken, now: datetime | None = None) -> None:
    current = now or utc_now()
    if current - as_utc(session.last_seen_at) >= timedelta(minutes=1):
        session.last_seen_at = current
        db.commit()


def revoke_session(db: Session, session: SessionToken) -> None:
    if session.revoked_at is None:
        session.revoked_at = utc_now()
        db.commit()


def revoke_all_sessions(db: Session, user_id: int, *, except_session_id: int | None = None) -> int:
    query = db.query(SessionToken).filter(SessionToken.user_id == user_id, SessionToken.revoked_at.is_(None))
    if except_session_id is not None:
        query = query.filter(SessionToken.id != except_session_id)
    count = query.update({SessionToken.revoked_at: utc_now()}, synchronize_session=False)
    db.commit()
    return count


def cleanup_expired_sessions(db: Session) -> int:
    settings = get_settings()
    cutoff = utc_now() - timedelta(seconds=settings.session_idle_timeout_seconds)
    count = db.query(SessionToken).filter(
        (SessionToken.expires_at <= utc_now()) | (SessionToken.last_seen_at <= cutoff) | (SessionToken.revoked_at.is_not(None))
    ).delete(synchronize_session=False)
    db.commit()
    return count


def csrf_token_matches(session: SessionToken, raw_csrf_token: str) -> bool:
    return hmac.compare_digest(session.csrf_token_hash, hash_token(raw_csrf_token))


def rotate_csrf_token(db: Session, session: SessionToken) -> str:
    raw_csrf_token = secrets.token_urlsafe(32)
    session.csrf_token_hash = hash_token(raw_csrf_token)
    db.commit()
    return raw_csrf_token


def _fernet() -> Fernet:
    secret = get_settings().secret_key.encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
