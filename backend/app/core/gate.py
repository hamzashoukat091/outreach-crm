"""The gate: every request proves a session or gets 401.

Middleware rather than a router dependency so no future router can forget to
opt in -- new endpoints are born gated. The allowlist is tiny and explicit:
login (how you get a session), health (docker's healthcheck has no cookies),
and CORS preflights (OPTIONS carries no credentials by design).
"""

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.db import SessionLocal
from app.services.auth import SESSION_COOKIE, resolve_session

OPEN_PATHS = {"/api/auth/login", "/health"}


class AuthGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in OPEN_PATHS:
            return await call_next(request)

        token = request.cookies.get(SESSION_COOKIE, "")
        db = SessionLocal()
        try:
            session = resolve_session(db, token)
        finally:
            db.close()

        if not session:
            return JSONResponse(
                {"detail": "Not signed in."},
                status_code=401,
                # The browser client keys its redirect-to-login off this.
                headers={"x-auth-required": "1"},
            )
        return await call_next(request)
