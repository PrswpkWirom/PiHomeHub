from __future__ import annotations

import secrets
from ipaddress import IPv6Address, ip_address, ip_network
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
    if _is_trusted_proxy(peer_ip, settings.trusted_proxy_ip_list):
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            hops = [value.strip() for value in forwarded.split(",")]
            if len(forwarded) > 2048 or len(hops) > 16:
                return "unknown"
            # Walk from the actual peer; stop at the first untrusted hop.
            # A client cannot prepend a forged address to impersonate a device.
            current = peer_ip
            for hop in reversed(hops):
                if not _is_trusted_proxy(current, settings.trusted_proxy_ip_list):
                    break
                try:
                    current = str(ip_address(hop))
                except ValueError:
                    return "unknown"
            return current
    return peer_ip[:64]


def _is_trusted_proxy(peer_ip: str, trusted_proxies: list[str]) -> bool:
    """Match configured proxy addresses exactly or as explicit CIDR networks."""
    try:
        peer = ip_address(peer_ip)
        if isinstance(peer, IPv6Address) and peer.ipv4_mapped:
            peer = peer.ipv4_mapped
    except ValueError:
        return False
    for configured in trusted_proxies:
        try:
            if peer in ip_network(configured, strict=False):
                return True
        except ValueError:
            continue
    return False


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
        # Preserve HTTPS URL generation without letting Uvicorn rewrite the peer.
        if request.client and _is_trusted_proxy(request.client.host, settings.trusted_proxy_ip_list):
            forwarded_scheme = request.headers.get("x-forwarded-proto")
            if forwarded_scheme in {"http", "https"}:
                request.scope["scheme"] = forwarded_scheme

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
                    if session is None or not session_is_valid(session):
                        return JSONResponse(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            content={"detail": "Invalid or expired session"},
                        )
                    if not csrf_token_matches(session, raw_csrf):
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
        if settings.is_production and not settings.uses_private_http:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
