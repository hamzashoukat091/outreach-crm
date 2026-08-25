"""Gmail API client: auth, fetching, and parsing into EmailMessage rows.

Deliberately httpx over google-api-python-client. The official library pulls
in a large dependency tree to wrap what is, for our purposes, four REST calls
-- and its auth layer wants to manage token files on disk, which does not fit
a container that gets its credentials from the environment.

Access tokens are cached in-process for their stated lifetime. The worker
ticks every 15s but syncs every 5 minutes; minting a token per sync would be
a needless round-trip on every one.
"""

import base64
import logging
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr

import httpx

from app.core.config import settings as env_settings

logger = logging.getLogger("outreach.gmail")

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

# Gmail's own cap is 500; this is the per-page size, not a total.
PAGE_SIZE = 100


class GmailError(Exception):
    """Any Gmail API failure. The worker logs and retries next tick."""


class GmailAuthError(GmailError):
    """Credentials are missing, revoked, or refused.

    Distinct because it is not retryable: the worker surfaces this to the UI
    as 'reconnect Gmail' rather than silently retrying forever.
    """


class HistoryExpired(GmailError):
    """The stored cursor is older than Gmail's history retention.

    Not an error condition so much as a fact of life -- Gmail keeps history
    for roughly a week. The caller answers it with a full sync.
    """


@dataclass
class ParsedEmail:
    """One Gmail message, flattened into what EmailMessage stores."""

    gmail_id: str
    gmail_thread_id: str
    rfc_message_id: str | None
    in_reply_to: str | None
    references: str | None
    from_address: str
    from_name: str
    to_addresses: list[str]
    cc_addresses: list[str]
    reply_to: str | None
    subject: str
    snippet: str
    body_text: str
    body_html: str
    attachments: list[dict]
    label_ids: list[str]
    internal_date: datetime

    @property
    def is_unread(self) -> bool:
        return "UNREAD" in self.label_ids

    @property
    def is_sent(self) -> bool:
        return "SENT" in self.label_ids

    @property
    def is_draft(self) -> bool:
        return "DRAFT" in self.label_ids


class GmailClient:
    """Thin, synchronous Gmail client scoped to one mailbox."""

    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        refresh_token: str | None = None,
    ) -> None:
        self.client_id = client_id or env_settings.gmail_client_id
        self.client_secret = client_secret or env_settings.gmail_client_secret
        self.refresh_token = refresh_token or env_settings.gmail_refresh_token
        self._access_token: str | None = None
        self._expires_at: datetime | None = None
        # The worker is single-threaded today, but the API process is not --
        # a lock here costs nothing and avoids two concurrent refreshes.
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.refresh_token)

    # ---- auth ----------------------------------------------------------

    def _token(self) -> str:
        with self._lock:
            now = datetime.now(timezone.utc)
            if self._access_token and self._expires_at and now < self._expires_at:
                return self._access_token

            if not self.configured:
                raise GmailAuthError("Gmail credentials are not configured")

            try:
                resp = httpx.post(
                    TOKEN_URL,
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "refresh_token": self.refresh_token,
                        "grant_type": "refresh_token",
                    },
                    timeout=30.0,
                )
            except httpx.HTTPError as exc:
                raise GmailError(f"token refresh failed: {exc}") from exc

            if resp.status_code != 200:
                detail = resp.text[:300]
                # invalid_grant means revoked, expired, or the app went back
                # to Testing status. No amount of retrying fixes it.
                if "invalid_grant" in detail:
                    raise GmailAuthError(
                        "Gmail refresh token is no longer valid -- reconnect the mailbox"
                    )
                raise GmailAuthError(f"token refresh failed ({resp.status_code}): {detail}")

            payload = resp.json()
            self._access_token = payload["access_token"]
            # 60s of slack so a token cannot expire mid-request.
            self._expires_at = now + timedelta(seconds=int(payload.get("expires_in", 3600)) - 60)
            return self._access_token

    def _get(self, path: str, params: dict | None = None) -> dict:
        try:
            resp = httpx.get(
                f"{API_BASE}{path}",
                headers={"Authorization": f"Bearer {self._token()}"},
                params=params or {},
                timeout=30.0,
            )
        except httpx.HTTPError as exc:
            raise GmailError(f"GET {path} failed: {exc}") from exc

        if resp.status_code == 404:
            # On history.list this specifically means the cursor is too old.
            raise HistoryExpired(f"{path} returned 404")
        if resp.status_code == 401:
            # Token rejected mid-flight. Drop the cache so the next call
            # re-mints rather than replaying a dead token.
            self._access_token = None
            raise GmailAuthError("Gmail rejected the access token")
        if resp.status_code == 403:
            raise GmailAuthError(
                f"Gmail refused the request (403). Is the Gmail API enabled? {resp.text[:200]}"
            )
        if resp.status_code >= 400:
            raise GmailError(f"GET {path} returned {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    # ---- reads ---------------------------------------------------------

    def profile(self) -> dict:
        return self._get("/profile")

    def list_message_ids(self, query: str | None = None, max_results: int = 500) -> list[str]:
        """Message ids matching a query, newest first. Used by full sync."""
        ids: list[str] = []
        page: str | None = None
        while len(ids) < max_results:
            params = {"maxResults": min(PAGE_SIZE, max_results - len(ids))}
            if query:
                params["q"] = query
            if page:
                params["pageToken"] = page
            payload = self._get("/messages", params)
            ids.extend(m["id"] for m in payload.get("messages") or [])
            page = payload.get("nextPageToken")
            if not page:
                break
        return ids

    def history_since(self, start_history_id: int) -> tuple[list[str], int | None]:
        """(new message ids, latest historyId) since the cursor.

        Raises HistoryExpired when the cursor has aged out, which is the
        caller's signal to fall back to a full sync.
        """
        ids: list[str] = []
        latest: int | None = None
        page: str | None = None

        while True:
            params = {
                "startHistoryId": str(start_history_id),
                # Only additions. Label changes and deletions do not create
                # rows, and asking for them means paging through noise.
                "historyTypes": "messageAdded",
                "maxResults": PAGE_SIZE,
            }
            if page:
                params["pageToken"] = page
            payload = self._get("/history", params)

            if payload.get("historyId"):
                latest = int(payload["historyId"])
            for record in payload.get("history") or []:
                for added in record.get("messagesAdded") or []:
                    msg = added.get("message") or {}
                    if msg.get("id"):
                        ids.append(msg["id"])

            page = payload.get("nextPageToken")
            if not page:
                break

        # Dedupe, preserving order: one message can appear in several records.
        return list(dict.fromkeys(ids)), latest

    def get_message(self, gmail_id: str) -> ParsedEmail:
        return parse_message(self._get(f"/messages/{gmail_id}", {"format": "full"}))


# ---- parsing -----------------------------------------------------------


def _header(headers: list[dict], name: str) -> str:
    for entry in headers:
        if entry.get("name", "").lower() == name.lower():
            return entry.get("value") or ""
    return ""


def _addresses(raw: str) -> list[str]:
    """Split a header into bare addresses.

    Naive comma splitting breaks on `"Surname, Given" <a@b.com>`, which is a
    common display-name form, so quoted sections are protected first.
    """
    if not raw:
        return []
    parts = re.split(r',(?=(?:[^"]*"[^"]*")*[^"]*$)', raw)
    out = []
    for part in parts:
        addr = parseaddr(part)[1].strip().lower()
        if addr:
            out.append(addr)
    return out


def _decode(data: str | None) -> str:
    if not data:
        return ""
    # Gmail uses URL-safe base64 without padding.
    padded = data + "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - a malformed part must not lose the message
        logger.warning("failed to decode a message part")
        return ""


def _walk_parts(part: dict, text: list[str], html: list[str], attachments: list[dict]) -> None:
    """Depth-first over the MIME tree, collecting bodies and attachment metadata."""
    mime = part.get("mimeType") or ""
    body = part.get("body") or {}
    filename = part.get("filename") or ""

    if filename and body.get("attachmentId"):
        attachments.append(
            {
                "filename": filename,
                "mime_type": mime,
                "size": body.get("size") or 0,
                "attachment_id": body["attachmentId"],
            }
        )
    elif mime == "text/plain":
        text.append(_decode(body.get("data")))
    elif mime == "text/html":
        html.append(_decode(body.get("data")))

    for child in part.get("parts") or []:
        _walk_parts(child, text, html, attachments)


def parse_message(payload: dict) -> ParsedEmail:
    """Gmail's message JSON -> ParsedEmail."""
    payload_part = payload.get("payload") or {}
    headers = payload_part.get("headers") or []

    text_parts: list[str] = []
    html_parts: list[str] = []
    attachments: list[dict] = []
    _walk_parts(payload_part, text_parts, html_parts, attachments)

    from_name, from_address = parseaddr(_header(headers, "From"))

    # internalDate is epoch milliseconds, and is Google's receive time rather
    # than the sender-supplied Date: header.
    internal_ms = int(payload.get("internalDate") or 0)
    internal_date = datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc)

    return ParsedEmail(
        gmail_id=payload["id"],
        gmail_thread_id=payload["threadId"],
        rfc_message_id=_header(headers, "Message-ID") or None,
        in_reply_to=_header(headers, "In-Reply-To") or None,
        references=_header(headers, "References") or None,
        from_address=from_address.lower(),
        from_name=from_name,
        to_addresses=_addresses(_header(headers, "To")),
        cc_addresses=_addresses(_header(headers, "Cc")),
        reply_to=(parseaddr(_header(headers, "Reply-To"))[1] or "").lower() or None,
        subject=_header(headers, "Subject"),
        snippet=payload.get("snippet") or "",
        body_text="\n".join(p for p in text_parts if p).strip(),
        body_html="\n".join(p for p in html_parts if p).strip(),
        attachments=attachments,
        label_ids=payload.get("labelIds") or [],
        internal_date=internal_date,
    )
