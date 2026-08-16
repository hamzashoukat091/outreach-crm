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

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Prospect, ProspectEvent, ProspectEventType

logger = logging.getLogger("outreach.prospect_import")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Vendor column -> model attribute.
COLUMN_MAP: dict[str, str] = {
    "prospect_id": "prospect_ref",
    "business_id": "business_ref",
    "contact_professions_email": "email",
    "contact_professional_email_status": "email_status",
    "prospect_first_name": "first_name",
    "prospect_last_name": "last_name",
    "prospect_job_title": "job_title",
    "prospect_job_department": "job_department",
    "prospect_linkedin": "linkedin",
    "prospect_city": "prospect_city",
    "prospect_region_name": "prospect_region",
    "prospect_country_name": "prospect_country",
    "business_name": "company_name",
    "business_domain": "company_domain",
    "business_website": "company_website",
    "business_business_description": "company_description",
    "business_city_name": "company_city",
    "business_region": "company_region",
    "business_country_name": "company_country",
    "business_number_of_employees_range": "employee_range",
    "business_yearly_revenue_range": "revenue_range",
    "business_naics_description": "industry",
    "business_naics": "naics",
    "business_sic_code": "sic_code",
    "business_logo": "company_logo",
}

JSON_LIST_COLUMNS = {
    "prospect_skills": "skills",
    "prospect_interests": "interests",
    "prospect_experience": "experience",
    "business_business_intent_topics": "intent_topics",
}

# Ignored: either redundant or pure vendor bookkeeping.
SKIP_COLUMNS = {
    "row_num",
    "created_at",
    "contact_emails",
    "prospect_full_name",
    "prospect_job_seniority_level",
    "business_sic_code_description",
}

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
    return (name or "").strip().lstrip("﻿").lower()


def parse_row(raw_row: dict[str, Any], row_no: int) -> tuple[dict | None, str | None]:
    """Turn one CSV row into model kwargs. Returns (payload, error)."""
    row = {_normalize_header(k): v for k, v in raw_row.items() if k is not None}

    email = _clean(row.get("contact_professions_email")).lower()
    if not email:
        # Fall back to the first professional address in contact_emails.
        for entry in _parse_json_list(row.get("contact_emails", "")):
            if isinstance(entry, dict) and "professional" in str(entry.get("type", "")):
                email = _clean(entry.get("address")).lower()
                if email:
                    break

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

    seniority = _parse_bracket_scalar(row.get("prospect_job_seniority_level", ""))
    if seniority:
        payload["seniority"] = seniority

    for attr in ("employee_range", "revenue_range"):
        if payload.get(attr):
            payload[attr] = _parse_bracket_scalar(payload[attr])

    # Keep alternate addresses; useful when a work address bounces.
    others = [
        e.get("address")
        for e in _parse_json_list(row.get("contact_emails", ""))
        if isinstance(e, dict) and _clean(e.get("address")) and e.get("address", "").lower() != email
    ]
    if others:
        payload["other_emails"] = others

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
    known = set(COLUMN_MAP) | set(JSON_LIST_COLUMNS) | SKIP_COLUMNS | {
        "prospect_job_seniority_level"
    }
    extra = {k: _clean(v) for k, v in row.items() if k not in known and _clean(v)}
    if extra:
        payload["extra"] = extra

    row_num = _clean(row.get("row_num"))
    if row_num.isdigit():
        payload["source_row"] = int(row_num)

    return payload, None


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
    if not headers & {"contact_professions_email", "contact_emails"}:
        result["errors"].append(
            "CSV needs a 'contact_professions_email' or 'contact_emails' column"
        )
        return result

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
