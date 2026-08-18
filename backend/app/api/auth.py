"""Login, logout, and session visibility.

Login is deliberately unhelpful on failure: one generic message whether the
username or the password was wrong, and a small sleep so failures cannot be
timed or hammered.
"""

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.auth import AuthSession, User
from app.services import auth as auth_service
from app.services.auth import SESSION_COOKIE

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=auth_service.SESSION_DAYS * 86400,
        httponly=True,      # invisible to page JS; XSS cannot read it
        samesite="lax",     # not sent on cross-site POSTs
        secure=False,       # localhost is plain http; flip behind TLS
        path="/",
    )


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not auth_service.verify_credentials(body.username, body.password):
        # A flat cost per failed attempt. Single-user local tool, so a simple
        # sleep is proportionate where a lockout table would be theatre.
        time.sleep(0.5)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Wrong username or password."
        )

    user = auth_service.ensure_user(db, body.username)
    token = auth_service.create_session(
        db,
        user,
        user_agent=request.headers.get("user-agent"),
        ip=request.client.host if request.client else None,
    )
    auth_service.purge_expired(db)
    _set_cookie(response, token)
    return {"ok": True, "username": user.username}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        auth_service.destroy_session(db, token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE, "")
    session = auth_service.resolve_session(db, token)
    if not session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    user = db.get(User, session.user_id)
    return {"username": user.username if user else "?", "session_id": str(session.id)}


@router.get("/sessions")
def list_sessions(request: Request, db: Session = Depends(get_db)):
    """Every live login for the current user, newest first, with the one
    making this request flagged so the UI can say 'this device'."""
    token = request.cookies.get(SESSION_COOKIE, "")
    current = auth_service.resolve_session(db, token)
    if not current:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    rows = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == current.user_id)
        .order_by(AuthSession.last_seen_at.desc())
    ).all()
    return [
        {
            "id": str(s.id),
            "created_at": s.created_at,
            "last_seen_at": s.last_seen_at,
            "expires_at": s.expires_at,
            "user_agent": s.user_agent,
            "ip": s.ip,
            "current": s.id == current.id,
        }
        for s in rows
    ]


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE, "")
    current = auth_service.resolve_session(db, token)
    if not current:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    if not auth_service.destroy_session_by_id(db, current.user_id, session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such session.")
    return {"ok": True}
