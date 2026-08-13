"""Email generation via the Claude API.

Context handling is the important part. Roughly 40% of the sample export carries
an email and title but no company block, so the prompt states plainly which
facts are known and instructs the model to write around what is missing instead
of inventing it. Every draft records the context it was given, so a thin
generation is never mistaken for a well-grounded one after the fact.
"""

import logging
from typing import Any

import anthropic

from app.core.config import settings
from app.models import Prospect, SenderProfile, Strategy

logger = logging.getLogger("outreach.generator")


class GenerationError(Exception):
    pass


# Rules that hold regardless of the user's strategy. Appended last so a strategy
# cannot instruct the model to fabricate.
GUARDRAILS = """
Hard rules, which override any other instruction:
- You are writing as ONE INDEPENDENT PERSON, not a company or an agency. Use
  "I", never "we", never "our team", never "us".
- Describe only the skills and services given in ABOUT THE SENDER. Never claim
  a credential, a past client, a result, or a technology that is not listed
  there. If you have no proof to cite, make the offer without one.
- Use ONLY the facts in the prospect context below. Never invent a metric, a
  customer name, a mutual connection, an event, or a detail about their company.
- If a fact is not given, write around it. Do not guess and do not use a
  placeholder like [Company] or {{company}} -- the message must be ready to send
  as written.
- Where the context is marked LIMITED, keep the email role-focused and general
  rather than pretending to specific knowledge of their business.
- No fake urgency, no invented deadlines, no flattery about work you cannot see.
- Output plain text only. No markdown, no preamble, no sign-off block beyond a
  simple name line.

Return exactly this format and nothing else:
SUBJECT: <one line>
BODY:
<the email body>
"""


def build_context(prospect: Prospect) -> tuple[str, str, dict[str, Any]]:
    """Render the prospect into prompt text.

    Returns (context_text, quality, context_used) where quality is 'rich' or
    'thin' -- thin meaning we lack the company block.
    """
    lines: list[str] = []
    used: dict[str, Any] = {}

    def add(label: str, value: Any, key: str | None = None) -> None:
        if value in (None, "", [], {}):
            return
        lines.append(f"- {label}: {value}")
        if key:
            used[key] = value

    lines.append("PERSON")
    add("Name", prospect.full_name, "name")
    add("Job title", prospect.job_title, "job_title")
    add("Department", prospect.job_department, "department")
    add("Seniority", prospect.seniority, "seniority")
    location = ", ".join(
        p for p in (prospect.prospect_city, prospect.prospect_region) if p
    )
    add("Location", location, "location")

    if prospect.skills:
        top_skills = [str(s) for s in prospect.skills[:12]]
        add("Listed skills", ", ".join(top_skills), "skills")

    if prospect.experience:
        roles = [str(e) for e in prospect.experience[:6]]
        add("Career history", "; ".join(roles), "experience")

    if prospect.interests:
        add("Interests", ", ".join(str(i) for i in prospect.interests[:8]), "interests")

    lines.append("")
    lines.append("COMPANY")

    has_company_facts = any(
        [prospect.company_description, prospect.industry, prospect.employee_range]
    )

    if prospect.company_inferred and not has_company_facts:
        # Be explicit that the name is derived, so the model doesn't treat it as
        # verified knowledge about the business.
        add(
            "Company name",
            f"{prospect.company_name} (inferred from their email domain "
            f"{prospect.company_domain} -- treat as the company name only, "
            f"nothing else about the business is known)",
            "company_name_inferred",
        )
    else:
        add("Company name", prospect.company_name, "company_name")

    add("Website", prospect.company_website or prospect.company_domain, "website")
    add("Industry", prospect.industry, "industry")
    add("Employees", prospect.employee_range, "employee_range")
    add("Revenue range", prospect.revenue_range, "revenue_range")
    company_location = ", ".join(
        p for p in (prospect.company_city, prospect.company_region) if p
    )
    add("Headquarters", company_location, "company_location")

    if prospect.company_description:
        description = prospect.company_description.strip()
        if len(description) > 1200:
            description = description[:1200].rsplit(" ", 1)[0] + "…"
        add("What they do (from their own description)", description, "description")

    if prospect.intent_topics:
        ranked = sorted(
            [t for t in prospect.intent_topics if isinstance(t, dict)],
            key=lambda t: t.get("score", 0),
            reverse=True,
        )[:4]
        if ranked:
            rendered = ", ".join(
                f"{t.get('topic')} (score {t.get('score')})" for t in ranked
            )
            lines.append(
                f"- Recent research signals: {rendered}"
            )
            lines.append(
                "  (These are topics the company has been actively researching. "
                "They are a strong hint at what they care about right now, but do "
                "NOT claim to know they are researching it.)"
            )
            used["intent_topics"] = rendered

    quality = "rich" if has_company_facts else "thin"

    if quality == "thin":
        lines.append("")
        lines.append(
            "CONTEXT IS LIMITED: no verified company description, industry, or "
            "size is available for this prospect. Write an email that is credible "
            "on the strength of their ROLE alone. Do not speculate about their "
            "company's business, product, size, or challenges."
        )

    return "\n".join(lines), quality, used


def build_sender_block(sender: "SenderProfile | None") -> str:
    """Describe who is writing and what they sell.

    Without this the model knows the prospect but not the offer, and fills the
    gap with generic "we help teams" filler.
    """
    if not sender or not sender.is_configured:
        return (
            "ABOUT THE SENDER\n"
            "- No sender profile has been filled in yet. Write the email around "
            "the prospect's situation and keep any mention of what you do vague "
            "rather than inventing services, tools, or results."
        )

    lines = ["ABOUT THE SENDER", "You are writing as this person, in the first person singular."]

    if sender.name:
        lines.append(f"- Name: {sender.name}")
    if sender.headline:
        lines.append(f"- Role: {sender.headline}")
    if sender.offer:
        lines.append(f"- What they offer: {sender.offer.strip()}")
    if sender.proof:
        lines.append(
            f"- Relevant experience you MAY reference (nothing beyond this): "
            f"{sender.proof.strip()}"
        )
    if sender.call_to_action:
        lines.append(f"- Preferred ask: {sender.call_to_action}")

    return "\n".join(lines)


def build_prompt(
    prospect: Prospect, strategy: Strategy, sender: "SenderProfile | None" = None
) -> tuple[str, str]:
    """Returns (system_prompt, user_message)."""
    context, quality, _used = build_context(prospect)

    system = strategy.system_prompt.strip()

    parts = [
        "Write one cold outreach email to the prospect described below.",
        "",
        build_sender_block(sender),
        "",
        "YOUR STRATEGY AND INSTRUCTIONS:",
        strategy.instructions.strip(),
    ]

    if strategy.tone:
        parts.append(f"\nTone: {strategy.tone}")
    if strategy.subject_hint:
        parts.append(f"Subject line guidance: {strategy.subject_hint}")
    parts.append(f"Hard length limit: {strategy.max_words} words for the body.")

    sign_off = (sender.signature if sender and sender.signature else None)
    if sign_off:
        parts.append(f"Sign off as: {sign_off}")

    parts += ["", "PROSPECT CONTEXT", context, "", GUARDRAILS]

    return system, "\n".join(parts)


def _parse_response(text: str) -> tuple[str, str]:
    """Split the SUBJECT/BODY response, tolerating small format drift."""
    subject = ""
    body = text.strip()

    if "SUBJECT:" in text:
        after = text.split("SUBJECT:", 1)[1]
        if "BODY:" in after:
            subject_part, body_part = after.split("BODY:", 1)
            subject = subject_part.strip().split("\n")[0].strip()
            body = body_part.strip()
        else:
            lines = after.strip().split("\n")
            subject = lines[0].strip()
            body = "\n".join(lines[1:]).strip()

    subject = subject.strip().strip('"').strip()
    if not subject:
        # Never ship an empty subject; fall back to the first body line.
        first = body.split("\n")[0].strip()
        subject = (first[:120] or "Quick question").strip()

    return subject[:500], body


def generate_email(
    prospect: Prospect, strategy: Strategy, sender: "SenderProfile | None" = None
) -> dict[str, Any]:
    """Call Claude and return the draft fields. Raises GenerationError."""
    if not settings.anthropic_api_key:
        raise GenerationError(
            "No ANTHROPIC_API_KEY configured. Add it to .env and restart the api service."
        )

    system, user_message = build_prompt(prospect, strategy, sender)
    _context, quality, used = build_context(prospect)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=90.0)

    try:
        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1200,
            system=system,
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.AuthenticationError as exc:
        raise GenerationError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.") from exc
    except anthropic.RateLimitError as exc:
        raise GenerationError("Rate limited by Anthropic. Wait a moment and retry.") from exc
    except anthropic.APIStatusError as exc:
        raise GenerationError(f"Anthropic API error ({exc.status_code}).") from exc
    except anthropic.APIConnectionError as exc:
        raise GenerationError("Could not reach the Anthropic API. Check connectivity.") from exc
    except Exception as exc:  # noqa: BLE001
        raise GenerationError(f"Generation failed: {exc}") from exc

    text = "".join(block.text for block in response.content if block.type == "text")
    if not text.strip():
        raise GenerationError("The model returned an empty response.")

    subject, body = _parse_response(text)

    return {
        "subject": subject,
        "body": body,
        "model": settings.anthropic_model,
        "context_quality": quality,
        "context_used": used,
        # Persisted so the draft can show exactly what was sent and returned,
        # even after the strategy behind it is edited.
        "system_prompt": system,
        "user_prompt": user_message,
        "raw_response": text,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
