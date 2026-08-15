"""Render an enrollment's history into prompt text.

Follow-ups and replies are written by a model that cannot see the database, so
the conversation is replayed to it as plain text. Only messages that actually
crossed the wire (or would have, in dry-run) are included -- a cancelled draft
never happened as far as the prospect is concerned.
"""

from datetime import datetime

from app.models import Message, MessageDirection, MessageState

# Enough to preserve meaning, small enough that a long thread does not crowd
# the instructions out of the prompt.
BODY_LIMIT = 1500


def _truncate(text: str | None) -> str:
    text = (text or "").strip()
    if len(text) <= BODY_LIMIT:
        return text
    return text[:BODY_LIMIT].rsplit(" ", 1)[0] + " […truncated]"


def _when(message: Message) -> str:
    stamp: datetime | None = message.sent_at or message.received_at or message.created_at
    return stamp.strftime("%b %d") if stamp else "date unknown"


def build_thread_context(messages: list[Message]) -> str:
    """Chronological transcript of what each side has actually said."""
    lines: list[str] = []
    step_no = 0

    ordered = sorted(
        messages,
        key=lambda m: (m.sent_at or m.received_at or m.created_at or datetime.min),
    )

    for message in ordered:
        if message.direction == MessageDirection.outbound:
            if message.state != MessageState.sent:
                continue
            step_no += 1
            header = f"YOU SENT (step {step_no}, {_when(message)}):"
            if message.subject:
                lines.append(f"{header}\nSubject: {message.subject}\n{_truncate(message.body)}")
            else:
                lines.append(f"{header}\n{_truncate(message.body)}")
        else:
            if message.state != MessageState.received:
                continue
            lines.append(f"THEY WROTE ({_when(message)}):\n{_truncate(message.body)}")

    if not lines:
        return "No prior messages in this thread."
    return "\n\n".join(lines)
