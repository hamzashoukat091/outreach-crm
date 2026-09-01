"""Answering inbound replies -- or knowing when not to.

The flow: classify the reply, apply the stop rules (unsubscribe suppresses,
a real reply ends the sequence, an autoresponder does nothing at all), then
either draft an answer or hold it for the human. Drafting is fenced by
SenderFacts: the model may state only what the user has written down, and must
output an ESCALATE line when the reply needs anything else. Guessing at rates
or availability in the user's name is the one failure mode this whole module
exists to prevent.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ALWAYS_ESCALATE,
    AutomationSettings,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    ProspectEventType,
    ReplySituation,
    SenderFacts,
    Strategy,
)
from app.services.classifier import classify_reply
from app.services.generator import (
    GUARDRAILS,
    GenerationError,
    _capitalize_subject,
    _parse_response,
    build_context,
    build_sender_block,
    call_claude,
)
from app.services.sequencer import log_event, on_reply, on_unsubscribe
from app.services.thread import build_thread_context

logger = logging.getLogger("outreach.replier")


def get_or_create_facts(db: Session) -> SenderFacts:
    facts = db.scalar(select(SenderFacts).limit(1))
    if not facts:
        facts = SenderFacts()
        db.add(facts)
        db.flush()
    return facts


def build_facts_block(facts: SenderFacts | None) -> str:
    """The complete universe of facts the model may state in a reply."""
    header = (
        "FACTS YOU MAY STATE -- anything not listed here you must not invent; "
        "if the reply needs an unlisted fact, output ESCALATE: <why> instead "
        "of an email."
    )
    if not facts or not facts.is_configured:
        return (
            f"{header}\n"
            "- No facts have been configured. You may not state any rate, "
            "availability, technology, or process detail. If the reply asks "
            "for any of those, escalate."
        )

    lines = [header]

    def add(label: str, value: str | None) -> None:
        if value and value.strip():
            lines.append(f"- {label}: {value.strip()}")

    add("Rates", facts.rates)
    add("Availability", facts.availability)
    add("Tech stack", facts.tech_stack)
    add("How an engagement runs", facts.process)
    add("Booking link (offer it when proposing a call)", facts.booking_link)
    add("Portfolio", facts.portfolio_link)
    add("Additional facts", facts.extra_facts)

    if facts.do_not_answer and facts.do_not_answer.strip():
        lines.append(
            f"- TOPICS YOU MUST NEVER ANSWER, even if a fact above seems to "
            f"cover them (escalate instead): {facts.do_not_answer.strip()}"
        )

    return "\n".join(lines)


def _pick_reply_strategy(db: Session, situation: str) -> Strategy | None:
    return db.scalar(
        select(Strategy)
        .where(
            Strategy.kind == "reply",
            Strategy.reply_situation == situation,
            Strategy.is_active.is_(True),
        )
        .order_by(Strategy.priority.asc(), Strategy.created_at.asc())
    )


def _has_sent_reply_before(db: Session, prospect_id) -> bool:
    return (
        db.scalar(
            select(Message.id)
            .where(
                Message.prospect_id == prospect_id,
                Message.kind == MessageKind.reply,
                Message.state == MessageState.sent,
            )
            .limit(1)
        )
        is not None
    )


def _reply_subject(inbound: Message) -> str:
    if inbound.enrollment and inbound.enrollment.thread_subject:
        base = inbound.enrollment.thread_subject
    else:
        base = (inbound.subject or "your email").strip()
        while base.lower().startswith("re:"):
            base = base[3:].strip()
    # Capitalise here too: this branch runs when the thread subject is
    # unknown and we are echoing back whatever the prospect's client sent,
    # which may itself be lowercase.
    return f"Re: {_capitalize_subject(base)}"[:500]


def handle_inbound(
    db: Session, inbound: Message, settings_row: AutomationSettings
) -> Message | None:
    """Process one freshly ingested inbound message end to end.

    Returns the outbound reply row (scheduled or needs_approval) when one was
    created, else None.
    """
    prospect = inbound.prospect
    enrollment = inbound.enrollment

    thread_context = (
        build_thread_context(list(enrollment.messages)) if enrollment else
        build_thread_context([inbound])
    )

    classification = classify_reply(inbound, thread_context, prospect)
    situation = classification["situation"]
    confidence = classification["confidence"]

    inbound.situation = ReplySituation(situation)
    inbound.classification_confidence = confidence
    inbound.classification_reason = classification["reason"]

    log_event(
        db,
        prospect.id,
        ProspectEventType.reply_received,
        f"Reply received ({situation}, {confidence}%): {classification['summary'] or inbound.subject}",
        {"message_id": str(inbound.id), "situation": situation, "confidence": confidence},
    )

    if situation == ReplySituation.auto_reply.value:
        # An autoresponder is not a person answering. The sequence keeps
        # running and nobody writes back to a robot.
        db.flush()
        return None

    if situation == ReplySituation.unsubscribe.value:
        on_unsubscribe(db, prospect, detail=classification["summary"] or inbound.subject)
        return None

    # A real human replied: the sequence's work is done.
    if enrollment:
        on_reply(db, enrollment, inbound)

    if not settings_row.auto_reply_enabled:
        db.flush()
        return None

    strategy = _pick_reply_strategy(db, situation)
    if strategy is None:
        # Nothing configured to handle this situation: hold an empty reply row
        # so it surfaces in the approvals queue with the inbound attached.
        return _hold_for_approval(
            db,
            inbound,
            subject=_reply_subject(inbound),
            body=None,
            strategy=None,
            situation=situation,
            reason=f"No active reply strategy for situation '{situation}'",
        )

    draft = _draft_reply(db, inbound, strategy, thread_context)
    if draft.get("escalate_output"):
        return _hold_for_approval(
            db,
            inbound,
            subject=_reply_subject(inbound),
            body=None,
            strategy=strategy,
            situation=situation,
            reason=draft["escalate_output"],
            provenance=draft,
        )

    escalate_reason = _escalation_reason(db, settings_row, situation, confidence, inbound)

    message = Message(
        prospect_id=prospect.id,
        # Via the relationship so a loaded enrollment.messages stays truthful.
        enrollment=inbound.enrollment,
        strategy_id=strategy.id,
        direction=MessageDirection.outbound,
        kind=MessageKind.reply,
        state=MessageState.needs_approval if escalate_reason else MessageState.scheduled,
        subject=draft["subject"],
        body=draft["body"],
        to_address=prospect.email,
        # Replies go out immediately: answering at 6pm is what a person does.
        # The worker still applies rate limits, suppression, pause and dry-run.
        scheduled_for=None if escalate_reason else datetime.now(timezone.utc),
        situation=ReplySituation(situation),
        classification_confidence=confidence,
        escalated=bool(escalate_reason),
        escalation_reason=escalate_reason,
        strategy_name=strategy.name,
        model=draft.get("model"),
        context_quality=draft.get("context_quality"),
        context_used=draft.get("context_used") or {},
        system_prompt=draft.get("system_prompt"),
        user_prompt=draft.get("user_prompt"),
        raw_response=draft.get("raw_response"),
        input_tokens=draft.get("input_tokens"),
        output_tokens=draft.get("output_tokens"),
    )
    db.add(message)

    if escalate_reason:
        log_event(
            db,
            prospect.id,
            ProspectEventType.escalated,
            f"Reply held for approval: {escalate_reason}",
            {"situation": situation, "confidence": confidence},
        )
    db.flush()
    return message


def _escalation_reason(
    db: Session,
    settings_row: AutomationSettings,
    situation: str,
    confidence: int,
    inbound: Message,
) -> str | None:
    """First matching rule wins; None means the reply may auto-send."""
    if confidence < settings_row.min_confidence_to_send:
        return f"Confidence {confidence}% below threshold {settings_row.min_confidence_to_send}%"
    if ReplySituation(situation) in ALWAYS_ESCALATE:
        return f"Situation '{situation}' always requires review"
    if situation in (settings_row.escalate_situations or []):
        return f"Situation '{situation}' is configured to require review"
    if settings_row.always_review_first_reply and not _has_sent_reply_before(
        db, inbound.prospect_id
    ):
        return "First reply to this prospect is always reviewed"
    return None


def _draft_reply(
    db: Session, inbound: Message, strategy: Strategy, thread_context: str
) -> dict:
    """Write the reply. Returns draft fields, or {'escalate_output': reason}
    (plus provenance) when the model itself declined for lack of facts."""
    from app.api.sender import get_or_create_profile  # local import: api layer

    prospect = inbound.prospect
    context, quality, used = build_context(prospect)
    sender = get_or_create_profile(db)
    facts = get_or_create_facts(db)

    parts = [
        "Write a reply to the email the prospect just sent, continuing the "
        "thread below. You have already been introduced -- never re-introduce "
        "yourself or restate your original pitch.",
        "",
        build_sender_block(sender),
        "",
        build_facts_block(facts),
        "",
        "THE THREAD SO FAR:",
        thread_context,
        "",
        "THE EMAIL YOU ARE REPLYING TO (verbatim):",
        f"Subject: {inbound.subject or '(none)'}",
        (inbound.body or "").strip()[:4000],
        "",
        "YOUR STRATEGY AND INSTRUCTIONS:",
        strategy.instructions.strip(),
    ]
    if strategy.tone:
        parts.append(f"\nTone: {strategy.tone}")
    parts.append(f"Hard length limit: {strategy.max_words} words for the body.")
    if sender and sender.signature:
        parts.append(f"Sign off as: {sender.signature}")

    parts += [
        "",
        "PROSPECT CONTEXT",
        context,
        "",
        GUARDRAILS,
        "EXCEPTION to the format above: if answering properly would require a "
        "fact that is not in FACTS YOU MAY STATE, or touches a topic marked as "
        "never-answer, output a single line 'ESCALATE: <what is missing>' and "
        "nothing else.",
    ]

    system = strategy.system_prompt.strip()
    user_message = "\n".join(parts)

    try:
        result = call_claude(system, user_message, max_tokens=max(1200, strategy.max_words * 8))
    except GenerationError as exc:
        # Drafting failed outright: surface via the approvals queue rather
        # than dropping the conversation on the floor.
        logger.warning("reply drafting failed: %s", exc)
        return {
            "escalate_output": f"Drafting failed: {exc}",
            "system_prompt": system,
            "user_prompt": user_message,
        }

    text = result["text"].strip()
    provenance = {
        "model": result["model"],
        "context_quality": quality,
        "context_used": used,
        "system_prompt": system,
        "user_prompt": user_message,
        "raw_response": result["text"],
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
    }

    if text.upper().startswith("ESCALATE"):
        reason = text.split(":", 1)[1].strip() if ":" in text else "Model requested escalation"
        return {"escalate_output": f"Model escalated: {reason}"[:400], **provenance}

    _subject, body = _parse_response(text)
    return {"subject": _reply_subject(inbound), "body": body, **provenance}


def redraft_reply(db: Session, message: Message) -> Message:
    """Rewrite a held reply in place, reusing the stored classification.

    The classify step is NOT re-run -- the inbound row already carries its
    situation and confidence, and re-classifying would double the timeline
    events. This exists for the fill-facts-then-regenerate loop: the model
    escalates for a missing rate, the user adds it to SenderFacts, and the
    same held message redrafts into a grounded answer. The hold is never
    bypassed: whatever comes back still waits for approval.
    """
    inbound = db.scalar(
        select(Message)
        .where(
            Message.prospect_id == message.prospect_id,
            Message.direction == MessageDirection.inbound,
            Message.created_at <= message.created_at,
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    if inbound is None:
        raise GenerationError("The email this reply answers can no longer be found.")

    situation = (message.situation or inbound.situation or ReplySituation.unclear).value
    strategy = _pick_reply_strategy(db, situation)
    if strategy is None:
        raise GenerationError(f"No active reply strategy handles '{situation}'.")

    thread_context = (
        build_thread_context(list(inbound.enrollment.messages))
        if inbound.enrollment
        else build_thread_context([inbound])
    )

    draft = _draft_reply(db, inbound, strategy, thread_context)

    message.strategy_id = strategy.id
    message.strategy_name = strategy.name
    message.edited = False
    for field in (
        "model",
        "context_quality",
        "system_prompt",
        "user_prompt",
        "raw_response",
        "input_tokens",
        "output_tokens",
    ):
        if draft.get(field) is not None:
            setattr(message, field, draft[field])
    if draft.get("context_used") is not None:
        message.context_used = draft["context_used"]

    if draft.get("escalate_output"):
        message.body = None
        message.escalated = True
        message.escalation_reason = draft["escalate_output"][:400]
    else:
        message.subject = draft["subject"]
        message.body = draft["body"]
        # Keep the original hold reason visible unless the model escalated anew.

    db.flush()
    return message


def _hold_for_approval(
    db: Session,
    inbound: Message,
    subject: str,
    body: str | None,
    strategy: Strategy | None,
    situation: str,
    reason: str,
    provenance: dict | None = None,
) -> Message:
    provenance = provenance or {}
    message = Message(
        prospect_id=inbound.prospect_id,
        enrollment=inbound.enrollment,
        strategy_id=strategy.id if strategy else None,
        direction=MessageDirection.outbound,
        kind=MessageKind.reply,
        state=MessageState.needs_approval,
        subject=subject,
        body=body,
        to_address=inbound.prospect.email,
        situation=ReplySituation(situation),
        classification_confidence=inbound.classification_confidence,
        escalated=True,
        escalation_reason=reason[:400],
        strategy_name=strategy.name if strategy else None,
        model=provenance.get("model"),
        context_used=provenance.get("context_used") or {},
        system_prompt=provenance.get("system_prompt"),
        user_prompt=provenance.get("user_prompt"),
        raw_response=provenance.get("raw_response"),
        input_tokens=provenance.get("input_tokens"),
        output_tokens=provenance.get("output_tokens"),
    )
    db.add(message)
    log_event(
        db,
        inbound.prospect_id,
        ProspectEventType.escalated,
        f"Reply held for approval: {reason}",
        {"situation": situation},
    )
    db.flush()
    return message
