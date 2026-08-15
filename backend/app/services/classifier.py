"""What is this reply doing? One Claude call, strict JSON out.

The classifier only names the situation; a separate reply strategy decides
what to say about it. Confidence is the model's own 0-100 estimate and feeds
the escalation rules -- an uncertain classification is a human's problem, so
every failure path here degrades to (unclear, 0) rather than raising.
"""

import json
import logging

from app.models import Message, Prospect, ReplySituation

from app.services.generator import GenerationError, call_claude

logger = logging.getLogger("outreach.classifier")

CLASSIFIER_SYSTEM = (
    "You classify replies to cold outreach emails. You read the thread and the "
    "reply, then output a single JSON object and nothing else -- no prose, no "
    "markdown fences. You are careful and literal: you classify what the reply "
    "actually says, not what the sender hopes it says."
)

SITUATION_GUIDE = """Situations (pick exactly one):
- interested: they want to proceed, learn more, or talk. Any genuine buying signal.
- question: they ask something concrete -- pricing, scope, tech, availability, process.
- objection: they push back ("too expensive", "we have someone", "not convinced").
- not_now: positive or neutral, but later ("circle back in Q3", "after our launch").
- referral: they point to a different person or team to talk to.
- not_interested: a clear no without hostility and without asking to be removed.
- unsubscribe: they ask to stop receiving email, in any words ("remove me", "stop emailing", "take me off your list"). Choose this whenever removal is requested, even angrily.
- auto_reply: an autoresponder -- out of office, "I'm away until", ticket receipts, "no longer with the company" autoreplies.
- unclear: none of the above fits, the reply is ambiguous, or it is empty/garbled.

A question inside an interested reply is still 'question' if answering it is required to move forward; 'interested' only when no concrete question is blocking."""


def _extract_json(text: str) -> dict:
    """Tolerate prose or fences around the object: first '{' to last '}'."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in response")
    return json.loads(text[start : end + 1])


def classify_reply(inbound_msg: Message, thread_context: str, prospect: Prospect) -> dict:
    """Returns {situation, confidence, reason, summary}; never raises."""
    user_message = "\n".join(
        [
            "Classify the reply below.",
            "",
            SITUATION_GUIDE,
            "",
            f"PROSPECT: {prospect.full_name}, {prospect.job_title or 'role unknown'} "
            f"at {prospect.display_company}",
            "",
            "THE THREAD SO FAR:",
            thread_context,
            "",
            "THE REPLY TO CLASSIFY:",
            f"Subject: {inbound_msg.subject or '(none)'}",
            (inbound_msg.body or "").strip()[:4000] or "(empty body)",
            "",
            "Output exactly this JSON shape and nothing else:",
            '{"situation": "<one of the situation names>", "confidence": <0-100>, '
            '"reason": "<one sentence: why this situation>", '
            '"summary": "<one sentence: what they said>"}',
        ]
    )

    fallback = {
        "situation": ReplySituation.unclear.value,
        "confidence": 0,
        "reason": "Classification failed",
        "summary": "",
    }

    try:
        result = call_claude(CLASSIFIER_SYSTEM, user_message, max_tokens=500)
        data = _extract_json(result["text"])
    except GenerationError as exc:
        logger.warning("classifier API call failed: %s", exc)
        fallback["reason"] = f"Classification failed: {exc}"
        return fallback
    except (ValueError, json.JSONDecodeError) as exc:
        logger.warning("classifier returned unparseable output: %s", exc)
        fallback["reason"] = "Classifier returned unparseable output"
        return fallback

    situation = str(data.get("situation", "")).strip().lower()
    if situation not in {s.value for s in ReplySituation}:
        # An invented label is itself a sign the model was unsure.
        situation = ReplySituation.unclear.value

    try:
        confidence = max(0, min(100, int(data.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0

    return {
        "situation": situation,
        "confidence": confidence,
        "reason": str(data.get("reason", ""))[:2000],
        "summary": str(data.get("summary", ""))[:2000],
    }
