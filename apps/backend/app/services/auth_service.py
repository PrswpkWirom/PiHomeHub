from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import COOKIE_NAME
from app.database.db import get_db
from app.models.user import SessionToken, User


async def get_current_user(
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    session = db.query(SessionToken).filter(SessionToken.token == session_token).one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    user = db.query(User).filter(User.id == session.user_id).one()
    return user
