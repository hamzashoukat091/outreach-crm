"""Import the enrichment export into `prospects`.

The vendor file is wide (37 columns), embeds JSON in several cells, and is
genuinely sparse -- in the sample, 40% of rows carry a valid work email and job
title but no company block at all. The rules here:

  * Only an email is truly required.
  * JSON-ish cells are parsed leniently; a malformed cell degrades to empty
    rather than failing the row.
  * A row with no company gets its domain derived from the email, is marked
    incomplete, and records exactly which fields were missing.
  * Unmapped columns are preserved in `extra` so no data is silently dropped.
"""

import csv
import io
import json
import logging
import re
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Prospect, ProspectEvent, ProspectEventType

logger = logging.getLogger("outreach.prospect_import")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# The CSV contract. Column name IS the field name -- no translation layer to
# remember, and a header row that reads as documentation.
#
# Replaced a vendor-shaped map ("business_naics_description",
# "contact_professions_email", "business_number_of_employees_range") that only
# matched one exporter's spelling. When that exporter renamed its columns the
# import silently produced prospects with no company data, which is worse than
# a rejection: the emails still generate, just generically.
COLUMN_MAP: dict[str, str] = {
    "email": "email",
    "email_status": "email_status",
    "first_name": "first_name",
    "last_name": "last_name",
    "job_title": "job_title",
    "job_department": "job_department",
    "linkedin": "linkedin",
    "city": "prospect_city",
    "region": "prospect_region",
    "country": "prospect_country",
    "company_name": "company_name",
    "company_domain": "company_domain",
    "company_website": "company_website",
    "company_description": "company_description",
    "company_city": "company_city",
    "company_region": "company_region",
    "company_country": "company_country",
    "employee_range": "employee_range",
    "revenue_range": "revenue_range",
    "industry": "industry",
    "prospect_ref": "prospect_ref",
    "business_ref": "business_ref",
}

JSON_LIST_COLUMNS = {
    "skills": "skills",
    "interests": "interests",
}

# Accepted and ignored, so a file carrying them is not rejected for it.
SKIP_COLUMNS = {
    "row_num",
    "created_at",
    "full_name",
    "notes",
}

REQUIRED_COLUMNS = ("email",)

# Present but empty is fine; absent entirely triggers the "needs info"
# warning on every row, so the import result names them.
RECOMMENDED_COLUMNS = (
    "first_name",
    "job_title",
    "company_name",
    "company_description",
    "industry",
    "employee_range",
)

# Company context we need for a well-grounded email.
COMPANY_SIGNALS = ("company_name", "company_description", "industry", "employee_range")


def _clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    # The export writes empty JSON arrays and literal nulls for missing values.
    if text.lower() in {"", "null", "none", "n/a", "-", "[]", "{}", '""'}:
        return ""
    return text


def _parse_json_list(raw: str) -> list:
    """Parse a JSON array cell, degrading to a comma split rather than failing."""
    text = _clean(raw)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return [p.strip() for p in text.strip("[]").split(",") if p.strip()]

    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        return [parsed]
    return [parsed]


def _parse_bracket_scalar(raw: str) -> str:
    """`["cxo"]` / `[51-200]` -> `cxo` / `51-200`."""
    text = _clean(raw)
    if not text:
        return ""
    parsed = _parse_json_list(text)
    if parsed:
        first = parsed[0]
        if isinstance(first, str):
            return first.strip()
        return str(first)
    return text.strip("[]").strip('"').strip()


def _domain_from_email(email: str) -> str:
    return email.split("@")[-1].lower() if "@" in email else ""


def _company_from_domain(domain: str) -> str:
    """nayya.com -> Nayya. A readable stand-in, clearly marked as inferred."""
    if not domain:
        return ""
    root = domain.split(".")[0]
    return root.replace("-", " ").replace("_", " ").title()


def _normalize_header(name: str) -> str:
    """Lowercase, trimmed, BOM stripped. No aliasing: one spelling per field,
    so a mistyped header is reported rather than silently ignored."""
    return (name or "").strip().lstrip("﻿").lower()


def parse_row(raw_row: dict[str, Any], row_no: int) -> tuple[dict | None, str | None]:
    """Turn one CSV row into model kwargs. Returns (payload, error)."""
    row = {_normalize_header(k): v for k, v in raw_row.items() if k is not None}

    email = _clean(row.get("email")).lower()
    if not email:
        return None, f"row {row_no}: no email address"
    if not EMAIL_RE.match(email):
        return None, f"row {row_no}: invalid email '{email}'"

    payload: dict[str, Any] = {"email": email}

    for column, attr in COLUMN_MAP.items():
        if attr == "email":
            continue
        value = _clean(row.get(column))
        if value:
            payload[attr] = value

    for column, attr in JSON_LIST_COLUMNS.items():
        parsed = _parse_json_list(row.get(column, ""))
        if parsed:
            payload[attr] = parsed

    # Still bracket-tolerant: exports sometimes write `["cxo"]` for a single
    # value, and rejecting that would be pedantic when the intent is clear.
    seniority = _parse_bracket_scalar(row.get("seniority", ""))
    if seniority:
        payload["seniority"] = seniority

    for attr in ("employee_range", "revenue_range"):
        if payload.get(attr):
            payload[attr] = _parse_bracket_scalar(payload[attr])

    # Company recovery for rows that arrived without a company block.
    domain = payload.get("company_domain") or _domain_from_email(email)
    if domain:
        payload["company_domain"] = domain

    missing = [f for f in COMPANY_SIGNALS if not payload.get(f)]
    payload["missing_fields"] = missing
    payload["is_complete"] = not missing

    # Always explicit, so a caller can trust the flag without a default lookup.
    payload["company_inferred"] = False
    if not payload.get("company_name") and domain:
        payload["company_name"] = _company_from_domain(domain)
        payload["company_inferred"] = True

    # Preserve unmapped columns rather than dropping them.
    known = set(COLUMN_MAP) | set(JSON_LIST_COLUMNS) | SKIP_COLUMNS | {"seniority"}
    extra = {k: _clean(v) for k, v in row.items() if k not in known and _clean(v)}
    if extra:
        payload["extra"] = extra

    row_num = _clean(row.get("row_num"))
    if row_num.isdigit():
        payload["source_row"] = int(row_num)

    return payload, None


def _unique_category(db: Session, category: str) -> str:
    """Give a repeat import of the same vertical its own label.

    Typing "Real Estate" a second time otherwise merges the new rows into the
    first run's 46, and nothing afterwards can separate them: imported_at is
    left untouched on an update, so even a timestamp filter would not recover
    the batch. Suffixing keeps each run selectable in the category dropdown
    that already exists, and keeps reply-rate-per-run meaningful.

    The suffix counts existing runs rather than incrementing the highest seen,
    so deleting "#2" and re-importing does not silently reuse its label.
    """
    taken = set(
        db.scalars(
            select(Prospect.category).where(
                or_(
                    Prospect.category == category,
                    Prospect.category.like(f"{category} #%"),
                )
            )
        ).all()
    )
    if category not in taken:
        return category
    # Cap at the column width (60); a name long enough to collide there is
    # already unusable as a label.
    for n in range(2, 1000):
        candidate = f"{category} #{n}"[:60]
        if candidate not in taken:
            return candidate
    return category


def import_prospects_csv(
    db: Session,
    content: bytes,
    update_existing: bool = True,
    category: str | None = None,
) -> dict[str, Any]:
    """Load a Vibe export. `category` labels every row with the vertical the
    CSV was sourced for, since the file itself carries no such column."""
    category = (category or "").strip()[:60] or None
    result: dict[str, Any] = {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "incomplete": 0,
        "errors": [],
        "category": category,
    }

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        result["errors"].append("CSV has no header row")
        return result

    headers = {_normalize_header(h) for h in reader.fieldnames}
    accepted = set(COLUMN_MAP) | set(JSON_LIST_COLUMNS) | SKIP_COLUMNS | {"seniority"}

    # Reject on a missing required column, and say what the file has instead
    # of only what it lacks -- the usual cause is a vendor export whose names
    # differ, and "email" alone does not help you find that.
    missing_required = [c for c in REQUIRED_COLUMNS if c not in headers]
    if missing_required:
        found = ", ".join(sorted(headers)[:8]) or "none"
        result["errors"].append(
            f"Missing required column: {', '.join(missing_required)}. "
            f"Found instead: {found}"
            + (" …" if len(headers) > 8 else "")
        )
        result["errors"].append(
            "Rename the headers to match: "
            + ", ".join(REQUIRED_COLUMNS + RECOMMENDED_COLUMNS)
        )
        return result

    # Everything else is advisory: import, then say what will be thin.
    unknown = sorted(h for h in headers if h and h not in accepted)
    if unknown:
        result["errors"].append(
            f"Ignored {len(unknown)} unrecognised column(s): {', '.join(unknown[:6])}"
            + (" …" if len(unknown) > 6 else "")
        )

    absent_recommended = [c for c in RECOMMENDED_COLUMNS if c not in headers]
    if absent_recommended:
        result["errors"].append(
            "No column for: "
            + ", ".join(absent_recommended)
            + ". Emails will be written without that context."
        )

    # Resolved once, after the file is known to be importable -- a rejected
    # CSV must not burn a run number.
    if category:
        category = _unique_category(db, category)
        result["category"] = category

    seen: set[str] = set()

    for row_no, raw_row in enumerate(reader, start=2):
        payload, error = parse_row(raw_row, row_no)
        if error:
            result["skipped"] += 1
            result["errors"].append(error)
            continue

        email = payload["email"]
        if email in seen:
            result["skipped"] += 1
            result["errors"].append(f"row {row_no}: duplicate in file ({email})")
            continue
        seen.add(email)

        if not payload.get("is_complete", True):
            result["incomplete"] += 1

        # The CSV has no category column; the label comes from the operator at
        # upload time and applies to the whole file.
        if category:
            payload["category"] = category

        # Match on the vendor id first, then email.
        existing = None
        if payload.get("prospect_ref"):
            existing = db.scalar(
                select(Prospect).where(Prospect.prospect_ref == payload["prospect_ref"])
            )
        if not existing:
            existing = db.scalar(select(Prospect).where(Prospect.email == email))

        if existing:
            if not update_existing:
                result["skipped"] += 1
                continue
            # Only overwrite with non-empty values, so a later thin export can't
            # blank out company data an earlier complete one provided.
            for key, value in payload.items():
                if key in {"is_complete", "missing_fields", "company_inferred"}:
                    continue
                # Category records which run first found this prospect, so it
                # is set once and never moved. Reassigning it here would shrink
                # the earlier run's batch every time a later file re-listed
                # someone -- the counts in the dropdown would drift downwards
                # and the original selection could never be recovered.
                if key == "category" and existing.category:
                    continue
                if value in (None, "", [], {}):
                    continue
                if key == "company_name" and existing.company_name and payload.get(
                    "company_inferred"
                ):
                    continue
                setattr(existing, key, value)

            still_missing = [f for f in COMPANY_SIGNALS if not getattr(existing, f, None)]
            existing.missing_fields = still_missing
            existing.is_complete = not still_missing
            result["updated"] += 1
        else:
            prospect = Prospect(**payload)
            db.add(prospect)
            db.flush()
            db.add(
                ProspectEvent(
                    prospect_id=prospect.id,
                    type=ProspectEventType.imported,
                    summary="Imported from CSV",
                    detail={
                        "row": row_no,
                        "complete": prospect.is_complete,
                        "missing": prospect.missing_fields,
                    },
                )
            )
            result["created"] += 1

    db.commit()

    if len(result["errors"]) > 25:
        extra_count = len(result["errors"]) - 25
        result["errors"] = result["errors"][:25] + [f"...and {extra_count} more issues"]

    logger.info("prospect import: %s", {k: v for k, v in result.items() if k != "errors"})
    return result
