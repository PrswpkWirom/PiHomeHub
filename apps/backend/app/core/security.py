from __future__ import annotations

import secrets
from datetime import UTC, datetime

from passlib.context import CryptContext
from sqlalchemy.orm import Session

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
