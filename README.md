# Outreach — Cold-Outreach Lead CRM

Prospect CRM with AI-drafted emails you review, copy, and send by hand — plus an
optional automated sequencing engine. FastAPI + Postgres + Next.js 15, all in Docker.

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

The database migrates and seeds three starter strategies on first boot.

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

## Automated sequences (separate, optional)

The original sequencing engine is untouched and lives under **Sequences** in the
nav — multi-step templates with day offsets, a background worker, and a send queue.
It is independent of the prospect/AI flow above: prospects are never enrolled
automatically, and nothing there sends without you enrolling a Lead yourself.

Mail from that engine defaults to `MAIL_DRIVER=console`, which logs and delivers
nothing. Setting `smtp` routes to Mailpit on :8025 — still nothing leaves the machine.

1. **Leads** → select a few → pick a sequence → **Enroll**.
2. **Dashboard** or **Send queue** → **Run sender now** (forces a tick instead of waiting for
   the worker's 15s interval).
3. On that lead, log activity as **They replied** → the sequence stops and its queued emails
   are canceled.

## Architecture

```
web (Next.js) → api (FastAPI) → db (Postgres)
                worker (loop) ↗
```

Five services: `db`, `api`, `worker`, `web`, `mailpit`.

**Enrollment materializes the plan.** Enrolling a lead writes one `scheduled_sends` row per
step, dated from each step's `delay_days`. The whole plan is therefore visible and cancellable
in the UI *before* anything goes out, and the worker's job reduces to "claim what's due"
rather than recomputing offsets every tick.

**The worker is a plain loop**, not a broker — the right size for an MVP. It claims due rows
with `SELECT ... FOR UPDATE SKIP LOCKED`, so scaling to multiple replicas needs no code change.

**Halting is enforced in the engine, not the UI.** A lead who replied, won, lost, or
unsubscribed is dropped from every active sequence, and each due send re-checks lead status
immediately before sending. A prospect who answers between scheduling and send time will not
receive the next step.

**Guardrails.** `DAILY_SEND_CAP` (default 200) bounds sends per day; `SEND_BATCH_SIZE` bounds
each tick. A failed send is recorded on the row with its error and never silently retried.

## Data model

Prospect / AI side:

| Table | Purpose |
|---|---|
| `prospects` | the enrichment export, with `is_complete` + `missing_fields` |
| `strategies` | editable generation prompts |
| `email_drafts` | generated emails, their provenance, and approval state |
| `prospect_events` | append-only timeline per prospect |

Sequencing side:

| Table | Purpose |
|---|---|
| `leads` | contact + status + `tags`/`custom_fields` (JSONB) |
| `sequences` / `sequence_steps` | ordered templates, `delay_days` per step |
| `enrollments` | a lead's run through a sequence |
| `scheduled_sends` | one row per step; stores the rendered copy that was sent |
| `activities` | append-only timeline per lead |

`prospects` is deliberately separate from `leads`: it mirrors the vendor's column
set and its sparsity instead of forcing that shape onto the sequencing model.

## Sequence templates (sequencing engine only)

Sequence steps support `{{merge_field}}`: `first_name`, `last_name`, `full_name`,
`company`, `title`, `phone`, `website`, `source`, plus any unrecognized CSV column
as `{{custom.industry}}`. Blank fields render as empty text rather than failing the
send, and the rendered copy is stored on the send row.

## Tests

```bash
docker compose exec api python -m pytest tests/ -q
```

40 tests, no API key or network required:

- **CSV parsing** — sparse rows, domain recovery, bracket scalars, malformed JSON,
  unmapped columns, bad emails.
- **Prompt building** — rich vs. thin classification, the inferred-company warning,
  intent ranking, guardrails always appended, response parsing.
- **Sequencing** — delay offsets, duplicate-enrollment refusal, the reply/opt-out
  halt, the daily cap, enrollment completion.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(empty)* | Required for generation; the rest of the app works without it |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | |
| `MAIL_DRIVER` | `console` | `console` \| `smtp` — sequencing engine only |
| `SEED_ON_START` | `true` | Demo *leads*; strategies always seed (idempotent) |
| `API_PORT` / `WEB_PORT` / `POSTGRES_PORT` | `8000` / `3000` / `5433` | |

`.env` is gitignored. Keep your API key there, never in `docker-compose.yml`.

## Not in this MVP

**No auth — the API is unauthenticated, so don't expose it publicly as-is.**

Also absent: open/click tracking, inbox sync (replies are logged by hand, which is
the tradeoff of manual sending), per-user ownership, A/B testing of strategies on
the same prospect, and automatic company enrichment for the thin rows. Bulk
generation is capped at 25 per batch and runs synchronously — fine at this list
size, but it would want a job queue before it scales much past a few hundred.
