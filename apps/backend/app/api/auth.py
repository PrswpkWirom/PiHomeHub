from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.security import COOKIE_NAME, create_session, destroy_session, verify_password
from app.database.db import get_db
from app.models.user import User
from app.schemas.auth import AuthUser, LoginRequest
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=AuthUser)
async def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    session = create_session(db, user.id)
    response.set_cookie(
        key=COOKIE_NAME,
        value=session.token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    return AuthUser.model_validate(user)


@router.post("/logout")
async def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if session_token:
        destroy_session(db, session_token)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.get("/me", response_model=AuthUser)
async def me(current_user: User = Depends(get_current_user)):
    return AuthUser.model_validate(current_user)
