"""Session authentication.

The token in the cookie is 256 bits from secrets.token_urlsafe; the database
stores only its SHA-256, so a DB dump cannot mint a login. Expiry is sliding:
using the app within the window pushes the deadline out to a full seven days
again, so the login only dies after a week of genuine absence.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.auth import AuthSession, User

SESSION_COOKIE = "outreach_session"
SESSION_DAYS = 7
# Bumping expires_at on literally every request would write on every poll;
# once per this interval keeps the slide real and the writes rare.
TOUCH_INTERVAL = timedelta(minutes=15)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def verify_credentials(username: str, password: str) -> bool:
    """Check against the .env login. compare_digest on both fields so neither
    the username nor the password check leaks timing."""
    if not settings.auth_username or not settings.auth_password:
        return False
    user_ok = hmac.compare_digest(username.encode(), settings.auth_username.encode())
    pass_ok = hmac.compare_digest(password.encode(), settings.auth_password.encode())
    return user_ok and pass_ok


def ensure_user(db: Session, username: str) -> User:
    """The .env login materialises as a row on first use, so sessions have a
    real user to point at and multi-user later is just more rows."""
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        user = User(username=username, display_name=username.title())
        db.add(user)
        db.flush()
    user.last_login_at = _now()
    return user


def create_session(
    db: Session, user: User, user_agent: str | None, ip: str | None
) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=_hash(token),
            expires_at=_now() + timedelta(days=SESSION_DAYS),
            user_agent=(user_agent or "")[:300] or None,
            ip=(ip or "")[:64] or None,
        )
    )
    db.commit()
    return token


def resolve_session(db: Session, token: str) -> AuthSession | None:
    """Return the live session for this token, sliding its expiry forward."""
    if not token:
        return None
    session = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == _hash(token))
    )
    if not session:
        return None
    now = _now()
    if session.expires_at <= now:
        db.delete(session)
        db.commit()
        return None
    if now - session.last_seen_at > TOUCH_INTERVAL:
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=SESSION_DAYS)
        db.commit()
    return session


def destroy_session(db: Session, token: str) -> None:
    db.execute(delete(AuthSession).where(AuthSession.token_hash == _hash(token)))
    db.commit()


def destroy_session_by_id(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> bool:
    """Revoke one session -- scoped to the owner, so a future second user
    cannot log the first one out."""
    result = db.execute(
        delete(AuthSession).where(
            AuthSession.id == session_id, AuthSession.user_id == user_id
        )
    )
    db.commit()
    return result.rowcount > 0


def purge_expired(db: Session) -> None:
    db.execute(delete(AuthSession).where(AuthSession.expires_at <= _now()))
    db.commit()
