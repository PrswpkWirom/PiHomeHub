from __future__ import annotations

import secrets
from urllib.parse import urlparse

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.config import get_settings
from app.core.security import CSRF_HEADER_NAME, csrf_token_matches, find_session, session_is_valid
from app.database.db import SessionLocal

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_TOKEN_EXEMPT_PATHS = {"/api/auth/login"}


def observed_source_ip(request: Request) -> str:
    peer_ip = request.client.host if request.client else "unknown"
    settings = get_settings()
    if peer_ip in settings.trusted_proxy_ip_list:
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        if forwarded:
            return forwarded[:64]
    return peer_ip[:64]


def origin_is_allowed(request: Request) -> bool:
    settings = get_settings()
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/") in {item.rstrip("/") for item in settings.allowed_origins_list}
    referer = request.headers.get("referer")
    if not referer:
        return False
    parsed = urlparse(referer)
    referer_origin = f"{parsed.scheme}://{parsed.netloc}"
    return referer_origin.rstrip("/") in {item.rstrip("/") for item in settings.allowed_origins_list}


class RequestSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        request.state.request_id = request.headers.get("x-request-id", secrets.token_hex(12))[:64]
        request.state.source_ip = observed_source_ip(request)

        if request.method in UNSAFE_METHODS:
            if not origin_is_allowed(request):
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Untrusted or missing request origin"},
                )

            raw_session = request.cookies.get(settings.cookie_name)
            if raw_session and request.url.path not in CSRF_TOKEN_EXEMPT_PATHS:
                raw_csrf = request.headers.get(CSRF_HEADER_NAME)
                if not raw_csrf:
                    return JSONResponse(
                        status_code=status.HTTP_403_FORBIDDEN,
                        content={"detail": "Missing CSRF token"},
                    )
                session_factory = getattr(request.app.state, "session_factory", SessionLocal)
                db = session_factory()
                try:
                    session = find_session(db, raw_session)
                    if session is None or not session_is_valid(session) or not csrf_token_matches(session, raw_csrf):
                        return JSONResponse(
                            status_code=status.HTTP_403_FORBIDDEN,
                            content={"detail": "Invalid CSRF token"},
                        )
                finally:
                    db.close()

        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
