from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import UTC, datetime

from cryptography.fernet import Fernet
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import SessionToken

COOKIE_NAME = "pihomehub_session"
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_session(db: Session, user_id: int) -> SessionToken:
    session = SessionToken(
        user_id=user_id,
        token=secrets.token_urlsafe(48),
        created_at=datetime.now(UTC),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def destroy_session(db: Session, token: str) -> None:
    db.query(SessionToken).filter(SessionToken.token == token).delete()
    db.commit()


def _fernet() -> Fernet:
    secret = get_settings().secret_key.encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
