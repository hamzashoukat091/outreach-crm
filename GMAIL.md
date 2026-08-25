# Gmail: reading and sending

The app reads mail through the Gmail API and sends through Gmail SMTP. Both
point at the same account, which is what closes the loop: you send from it,
prospects reply to it, and sync pulls the reply back into the CRM.

```
send (SMTP) ──▶ prospect ──▶ replies ──▶ Gmail ──▶ sync (5 min) ──▶ classify ──▶ approvals
```

## Two credentials, two jobs

| | Reads mail | Sends mail |
|---|---|---|
| Mechanism | OAuth, `gmail.readonly` | App Password over SMTP |
| Lives in | `GMAIL_REFRESH_TOKEN` | `SMTP_APP_PASSWORD` |
| Can it send? | No | — |
| Can it read? | — | No |

Deliberately split. The read token cannot send mail and cannot delete
anything; the send password cannot read the mailbox. Neither is the account
password, and neither is in the repo.

## First-time setup

### 1. Google Cloud

Create a project, then:

- **APIs & Services → Library** → enable **Gmail API**
- **Clients** → Create client → **Desktop app**  ← not Web application
- **Data Access** → add scope `https://www.googleapis.com/auth/gmail.readonly`
- **Audience** → **External**, then **Publish app**

Desktop app matters: it authorises against `http://localhost`, so no public
callback route is needed. A Web application client would require one.

Publishing matters more. In **Testing** status Google revokes the refresh
token after **7 days** and sync stops with no error anyone would notice.
In Production it does not expire. Unverified is fine — verification is only
enforced as you approach the 100-user cap, and this is a one-user app.

"Internal" user type looks attractive (no verification at all) but only works
for Google Workspace accounts. On a consumer Gmail address it fails at
sign-in with `Error 403: org_internal`.

### 2. Authorise

```bash
python backend/scripts/gmail_authorize.py
```

Opens a browser, prints four `GMAIL_*` lines. Paste them into `.env`.
Expect an "unverified app" warning — Advanced → Go to … (unsafe).

The script reports which mailbox it opened. Check it: authorising the wrong
Google account is the easy mistake, and it silently syncs the wrong inbox.

### 3. App Password for sending

Requires 2-Step Verification on the account first, then
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
16 characters, strip the spaces, into `.env` as `SMTP_APP_PASSWORD`.

Gmail refuses the normal account password for SMTP.

### 4. Point the app at it

Settings → the SMTP block:

```
host      smtp.gmail.com
port      587  (TLS on)
username  <the gmail address>
password  <the app password>
from      <the same gmail address>
```

`from_address` must match the authenticated account or Gmail rewrites the
header, and replies then go somewhere sync is not watching.

## How sync works

The worker syncs every 5 minutes as a fourth phase of its existing loop — no
separate process or cron.

**Full sync** runs once at connect, walking the last 30 days
(`GMAIL_INITIAL_SYNC_DAYS`). **Partial sync** is the normal path: `history.list`
asks Gmail what changed since the stored cursor, so nothing is re-downloaded.

The cursor (`gmail_accounts.history_id`) advances **only after a batch
commits**. A crash therefore re-fetches rather than skips, and the unique
index on `(account_id, gmail_id)` makes the re-fetch a no-op.

### When the cursor expires

Gmail keeps history for **about a week**. If the worker is down longer than
that, `history.list` returns 404. Sync catches this, falls back to a full
re-sync, and increments `full_sync_count`.

That counter is the diagnostic worth watching: if it climbs on its own, the
worker is spending too long down.

## What is stored

Everything in the mailbox — not just prospect mail. `email_messages` holds
one row per email: both bodies, cc/reply-to, attachment metadata, labels.

Attachment **bytes are not stored**, only filename/type/size. A 25MB PDF per
row bloats Postgres and Gmail already has it.

`prospect_id` is set when the sender (or, for sent mail, the recipient)
matches a prospect. That is what the Mailbox page's **Prospects** filter uses.
Everything else is still stored and visible under **All mail**.

### Mailbox vs Inbox

Two pages, on purpose:

- **/mailbox** — the Gmail account. Every email, filterable.
- **/inbox** — the CRM pipeline. Only conversations with an enrolled prospect.

`messages.email_message_id` links them. They are not merged because the
pipeline has rows that are not email (drafts that never sent) and the mailbox
has mail that is not pipeline (everything from non-prospects).

## Our own sends

Gmail stores sent mail in the same mailbox, so sync fetches it back. Those
rows are stored and attributed to the prospect — so a thread shows both
halves — but they **do not enter the pipeline**. Without that guard the
classifier would read our own outreach as a prospect reply and draft an
answer to ourselves.

## Rendering email HTML

Email HTML is the one input in this app whose author is the entire internet.
It is sanitised **at render time** through an allowlist
(`services/html_sanitize.py`): script, style, iframe, object, form, event
handlers and `javascript:`/`data:` URLs are all dropped.

Sanitising at render rather than on the way in is deliberate — a fix to the
rules then applies to mail already stored.

Remote images are blocked by default and surfaced as "N remote images
blocked", with a button to load them. In email they are predominantly
tracking pixels: loading one tells the sender when you opened it.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_grant` | Token revoked, or the app went back to Testing. Re-run the auth script. |
| 403 on every call | Gmail API not enabled on the project. |
| `Error 403: org_internal` at sign-in | Audience is Internal on a consumer account. Make external. |
| Sync silent, no errors | Check `/api/mail/status` → `last_error`. |
| `full_sync_count` climbing | Worker down longer than Gmail's history retention. |
| Replies never appear | Is `from_address` the same account sync reads? |

`/api/mail/status` is the honest answer to "is this working" — it reports the
cursor, last sync time, and any stored error. A mailbox whose token was
revoked looks exactly like a quiet one from the message list alone.

## Sending limits

Gmail caps at **500 messages/day** regardless of app settings.

A new Gmail account sending cold outreach is the textbook spam profile: no
sending history, no reputation, sudden outbound volume. Start at 5–10/day and
raise it over a couple of weeks. The app's own hourly/daily limits are in
Settings.
