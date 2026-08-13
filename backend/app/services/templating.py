import re

from app.models import Lead

# Matches {{ field }} / {{custom.key}} with optional surrounding whitespace.
TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def lead_context(lead: Lead) -> dict[str, str]:
    """Flatten a lead into the merge-field namespace templates can reference."""
    ctx: dict[str, str] = {
        "email": lead.email or "",
        "first_name": lead.first_name or "",
        "last_name": lead.last_name or "",
        "full_name": lead.full_name,
        "company": lead.company or "",
        "title": lead.title or "",
        "phone": lead.phone or "",
        "website": lead.website or "",
        "source": lead.source or "",
    }
    for key, value in (lead.custom_fields or {}).items():
        ctx[f"custom.{key}"] = "" if value is None else str(value)
    return ctx


def render(template: str, context: dict[str, str]) -> tuple[str, list[str]]:
    """Substitute merge fields, returning the text and any tokens that resolved empty.

    Unknown or blank tokens render as an empty string rather than raising, so a
    partially-filled lead never blocks a send; the caller decides what to do with
    the `missing` list.
    """
    missing: list[str] = []

    def _sub(match: re.Match[str]) -> str:
        token = match.group(1)
        value = context.get(token, "")
        if not value:
            missing.append(token)
        return value

    return TOKEN_RE.sub(_sub, template), sorted(set(missing))


def render_for_lead(subject: str, body: str, lead: Lead) -> tuple[str, str, list[str]]:
    ctx = lead_context(lead)
    rendered_subject, missing_subject = render(subject, ctx)
    rendered_body, missing_body = render(body, ctx)
    return rendered_subject, rendered_body, sorted(set(missing_subject + missing_body))
