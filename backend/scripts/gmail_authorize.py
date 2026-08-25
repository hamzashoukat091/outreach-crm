"""One-time Gmail authorisation. Run this on your laptop, not the server.

Opens a browser, you sign in, and it prints a refresh token to paste into
.env. Uses the OAuth loopback flow: Google redirects to a throwaway
http://localhost server this script runs for a few seconds, so nothing needs
to be publicly reachable and no callback route is added to the app.

Deliberately stdlib-only. This runs once, on a laptop, outside Docker --
requiring the backend's dependency set installed locally just to authorise a
mailbox would be a needless obstacle.
"""

import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
DEFAULT_CLIENT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "secrets",
    "gmail_client_secret.json",
)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class _Catcher(http.server.BaseHTTPRequestHandler):
    """Catches the single redirect Google makes back to localhost."""

    result: dict = {}

    def do_GET(self) -> None:  # noqa: N802
        query = urllib.parse.urlparse(self.path).query
        _Catcher.result = dict(urllib.parse.parse_qsl(query))
        ok = "code" in _Catcher.result
        body = (
            b"<h2>Authorised.</h2><p>You can close this tab and return to the terminal.</p>"
            if ok
            else b"<h2>Authorisation failed.</h2><p>Check the terminal.</p>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        pass  # the default logger would print the auth code to stderr


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-file", default=DEFAULT_CLIENT_FILE)
    args = parser.parse_args()

    if not os.path.exists(args.client_file):
        print(f"Client secret file not found: {args.client_file}", file=sys.stderr)
        return 1

    with open(args.client_file, encoding="utf-8") as handle:
        blob = json.load(handle)
    cfg = blob.get("installed") or blob.get("web")
    if not cfg:
        print("Unrecognised client file: expected an 'installed' or 'web' key.", file=sys.stderr)
        return 1
    if "installed" not in blob:
        print(
            "Warning: this is a Web application client. The loopback flow expects "
            "a Desktop app client.",
            file=sys.stderr,
        )

    port = _free_port()
    redirect_uri = f"http://localhost:{port}"

    # PKCE. Not strictly required for a desktop client, but it makes the
    # authorisation code useless on its own to anything that intercepts it.
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .decode()
        .rstrip("=")
    )
    state = secrets.token_urlsafe(24)

    auth_url = cfg["auth_uri"] + "?" + urllib.parse.urlencode(
        {
            "client_id": cfg["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            # access_type=offline is what makes Google issue a refresh token at
            # all; prompt=consent forces a fresh one even when this account has
            # authorised before (Google omits it on repeat grants otherwise).
            "access_type": "offline",
            "prompt": "consent",
        }
    )

    server = http.server.HTTPServer(("127.0.0.1", port), _Catcher)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print("\nOpening your browser to authorise Gmail access.")
    print("Sign in as the OUTREACH account, not your personal one.")
    print('Google will warn the app is unverified: Advanced -> "Go to ... (unsafe)".')
    print(f"\nIf the browser does not open, paste this:\n\n{auth_url}\n")
    try:
        webbrowser.open(auth_url)
    except Exception:  # noqa: BLE001
        pass

    print("Waiting for the redirect...")
    for _ in range(300):
        if _Catcher.result:
            break
        threading.Event().wait(1)
    server.server_close()

    result = _Catcher.result
    if not result:
        print("Timed out waiting for authorisation.", file=sys.stderr)
        return 1
    if "error" in result:
        print(f"Authorisation denied: {result['error']}", file=sys.stderr)
        return 1
    if result.get("state") != state:
        print("State mismatch -- ignoring this response.", file=sys.stderr)
        return 1

    data = urllib.parse.urlencode(
        {
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "code": result["code"],
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(cfg["token_uri"], data=data), timeout=30
        ) as resp:
            tokens = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()
        print(f"Token exchange failed (HTTP {exc.code}): {detail}", file=sys.stderr)
        if "invalid_grant" in detail:
            print("\nUsually means the code expired. Run the script again.", file=sys.stderr)
        return 1

    refresh = tokens.get("refresh_token")
    if not refresh:
        print(
            "Google returned no refresh token. That happens when the account has "
            "already granted access; revoke it at "
            "https://myaccount.google.com/permissions and run this again.",
            file=sys.stderr,
        )
        return 1

    # Confirm the token works and, more usefully, report WHICH mailbox it
    # opened. Authorising the wrong Google account is the easiest mistake to
    # make here, and it would silently sync the wrong inbox.
    try:
        req = urllib.request.Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            profile = json.loads(resp.read())
        address = profile.get("emailAddress", "(unknown)")
        print(f"\nConnected to {address} ({profile.get('messagesTotal')} messages).")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()
        print(
            f"\nToken issued, but the Gmail probe failed (HTTP {exc.code}): {detail[:300]}",
            file=sys.stderr,
        )
        if exc.code == 403:
            print(
                "A 403 here almost always means the Gmail API is not enabled for "
                "this project.",
                file=sys.stderr,
            )
        return 1

    print("\n" + "=" * 68)
    print("Add these to backend/.env (and the server's .env). Do not commit them.")
    print("=" * 68)
    print(f"GMAIL_CLIENT_ID={cfg['client_id']}")
    print(f"GMAIL_CLIENT_SECRET={cfg['client_secret']}")
    print(f"GMAIL_REFRESH_TOKEN={refresh}")
    print(f"GMAIL_ADDRESS={address}")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())
