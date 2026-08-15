# Outreach — Cold-Outreach CRM

One prospect list, two pipelines. **Outreach**: AI-drafted emails you review,
copy, and send by hand. **Sequences**: full automation — Claude drafts every
step, sends on a schedule, reads the replies, classifies them, and answers them,
holding anything risky for your approval. FastAPI + Postgres + Next.js 15, all
in Docker.

## Quick start

```bash
docker compose up --build
```

Add your key to `.env` first (copy from `.env.example`):

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| Mailpit (captured email) | http://localhost:8025 |
| Postgres | localhost:5433 |

The database migrates and seeds twelve starter strategies on first boot — six
openers and six reply strategies, one per reply situation.

## The main workflow

1. **Prospects → Import CSV.** Your enrichment export loads as-is.
2. Select rows → pick a strategy → **Generate**.
3. **Outbox** → read each draft, edit if needed → **Copy & mark sent**.
   One click copies the email to your clipboard and records it as sent.
4. Paste into your mail client and send.
5. When they reply, open the prospect and log it — status and analytics follow.

**Nothing is emailed automatically.** Generation writes drafts; you send them.

## Handling incomplete CSV data

Enrichment exports are sparse. In the 48-row sample, **19 rows (40%) had a valid
work email and job title but no company block at all**. The import handles that
rather than rejecting it:

- Only an email is required; every other column may be missing.
- Common header spellings are mapped automatically, and unrecognized columns are
  preserved in `extra` rather than dropped.
- JSON-embedded cells (`intent_topics`, `skills`, `contact_emails`) are parsed,
  and a malformed cell degrades to empty instead of failing the row.
- Bracket-wrapped scalars are unwrapped: `["owner"]` → `owner`, `[51-200]` → `51-200`.
- A row with no company gets its domain derived from the email
  (`shruti@nayya.com` → `nayya.com` → "Nayya"), is flagged **incomplete**, and
  records exactly which fields were missing. The derived name is marked
  `company_inferred` so it is never treated as verified.
- Re-importing is idempotent, matched on the vendor's `prospect_id` then email.
  **Values you fill in by hand are never overwritten by a later thin export.**

Incomplete prospects are filterable, badged in the list, and show a "Fill in"
panel on their detail page — a sentence about what the company does measurably
improves the generated email.

## AI generation

Prompts live in **Strategies**, editable in the UI with no redeploy. Each holds a
system prompt, instructions, tone, length cap, and subject guidance. Three ship by
default: *Problem-first*, *Intent-signal led*, and *Role-only (thin context)*.

The prospect's data is appended as context automatically, followed by guardrails
that **cannot be overridden by a strategy**: use only the given facts, never
invent a metric or customer, never emit `[Company]` placeholders, and where
context is thin, stay role-focused rather than pretending to know the business.

Every draft records the model, the strategy, the token counts, and a
`context_quality` of **rich** or **thin** — surfaced as a badge so a thinly-grounded
email is never mistaken for a well-researched one. Use **Preview full prompt** on a
strategy to see exactly what gets sent.

## Tracking

Approving a draft means *"I copied this and sent it."* It stamps the send time,
advances the prospect to **sent**, writes a timeline entry with the exact copy that
went out, and discards competing drafts for that prospect. Replies and bounces are
logged manually and drive the funnel.

## Analytics

Pipeline by status, data completeness, per-strategy approval and reply rates, and
segment breakdowns by seniority, industry, company size, and research-intent topic.

One chart answers the question this dataset raises directly: **do emails written
with full company context get approved more often than those written from a job
title alone?**

**Nothing sends real email by default.** `MAIL_DRIVER=console` logs each message and delivers
nothing. Set `MAIL_DRIVER=smtp` and compose routes mail to Mailpit, where you can read it at
:8025 — still nothing leaves your machine. Point `SMTP_HOST` at a real relay only when you
mean it.

## Sequences — full automation

Every prospect has a **pipeline mode**: `manual` (the Outreach flow above) or
`automated`. **Hand off to automation** from the prospect page or the bulk bar;
return to manual any time no enrollment is open. One record, one timeline —
nothing is copied or lost moving between the two.

There are no templates. A sequence step is just *wait N days + a strategy*, and
Claude writes each email at send time with the whole thread as context, so a
follow-up never repeats the opener or re-introduces you.

The loop, end to end:

1. **Sequences** → build steps → **Enroll prospects**. Timing per enrollment:
   draft now and send later (default: next day at your configured time), send at
   the next opportunity, or a specific date and time.
2. The worker drafts, waits for the send window, and sends — threading each
   message under the opener with real `In-Reply-To`/`References` headers.
3. Replies are read back in (Mailpit's API locally; IMAP when you configure your
   mailbox), matched to their thread, and **classified**: interested, question,
   objection, not now, referral, not interested, unsubscribe, auto-reply, unclear.
4. A reply cancels the remaining steps. Unsubscribes go to a **suppression list**
   keyed on the email address, which survives re-imports and re-enrollment.
   Bounces suppress too.
5. Claude drafts an answer using a **reply strategy** for that situation — and it
   may state only what you wrote in **Sender facts** (rates, availability, stack,
   topics it must never answer). A reply that needs anything else is **held**.
6. Held replies land in **Approvals** with the triggering email and the reason.
   Approve, edit, or reject; fill in the missing fact and **Regenerate** to get a
   grounded answer. Questions, objections, low-confidence classifications, and
   the first-ever reply to each prospect are always held.

**Safety.** Dry-run ships ON: everything runs — drafting, scheduling, state —
but nothing is delivered until you flip it off in Settings. A pause button halts
sending independently. Sends respect a configurable window (default Mon–Fri
09:00–17:00, any timezone), an hourly cap (20) and a daily cap (100), checked
against the suppression list immediately before the socket opens.

**Settings** is the control panel for all of it — schedule, limits, reply
behaviour, SMTP/IMAP transport — each section with its own save and
reset-to-defaults. Leave the transport empty and mail stays in Mailpit.

## Architecture

```
web (Next.js) → api (FastAPI) → db (Postgres)
                worker (loop) ↗   ↘ mailpit (SMTP out + inbox poll)
```

Five services: `db`, `api`, `worker`, `web`, `mailpit`.

**Enrollment materializes the plan.** Enrolling writes the first `messages` row;
each send schedules the next step. The plan is visible and cancellable in the UI
before anything goes out, and the worker's job reduces to "claim what's due"
with `SELECT ... FOR UPDATE SKIP LOCKED` — scaling to replicas needs no code change.

**Halting is enforced in the engine, not the UI.** Stop rules run on ingest, and
every due send re-checks suppression, pause, and window immediately before
sending. A prospect who answers between scheduling and send time will not
receive the next step.

## Data model

| Table | Purpose |
|---|---|
| `prospects` | the enrichment export, with `is_complete`, `missing_fields`, `pipeline_mode` |
| `strategies` | editable prompts; `kind` opener \| reply, `reply_situation`, `priority` |
| `email_drafts` | manual-side generated emails, their provenance and approval state |
| `prospect_events` | append-only timeline per prospect, both pipelines |
| `sequences` / `sequence_steps` | ordered steps: `wait_days`, time of day, strategy |
| `sequence_enrollments` | a prospect's run; a partial unique index blocks double-runs |
| `messages` | every automated email in or out: RFC headers, state, full prompt provenance |
| `suppressions` | never-contact list keyed on email, survives re-import |
| `sender_facts` | the only facts Claude may state when answering questions |
| `automation_settings` | the control panel row: window, limits, transport, dry-run |

## Tests

```bash
docker compose exec api python -m pytest tests/ -q
```

104 tests, no API key or network required (model calls are monkeypatched):

- **CSV parsing** — sparse rows, domain recovery, bracket scalars, malformed JSON,
  unmapped columns, bad emails.
- **Prompt building** — rich vs. thin classification, the inferred-company warning,
  intent ranking, guardrails always appended, response parsing.
- **Sequencing** — scheduling and window clamping, duplicate-enrollment refusal,
  stop rules, cross-enrollment unsubscribe, bounce suppression, completion.
- **Replies** — every escalation gate, the facts fence and its ESCALATE hatch,
  redraft-in-place, auto-reply and unsubscribe handling, window-ignore for replies.
- **Inbox** — dedupe by RFC id, header matching, address fallback, bounce
  detection, stranger mail ignored.
- **Handoff + archive** — mode flips, blocked return while enrolled, status
  preserved through archive/restore.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(empty)* | Required for generation; the rest of the app works without it |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | |
| `MAIL_DRIVER` | `console` | Fallback transport when Settings has no SMTP host |
| `SEED_ON_START` | `true` | Strategies seed idempotently on boot |
| `API_PORT` / `WEB_PORT` / `POSTGRES_PORT` | `8000` / `3000` / `5433` | |

`.env` is gitignored. Keep your API key there, never in `docker-compose.yml`.

## Not in this MVP

**No auth — the API is unauthenticated, so don't expose it publicly as-is.**

Also absent: open/click tracking, per-user ownership, A/B testing of strategies
on the same prospect, and automatic company enrichment for the thin rows. Bulk
generation is capped at 25 per batch and runs synchronously — fine at this list
size, but it would want a job queue before it scales much past a few hundred.
On the automated side: no DKIM/SPF checking (that lives with your mail
provider), and classification costs one model call per inbound email.
