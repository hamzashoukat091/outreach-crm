import csv
import io

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Activity, ActivityType, Lead
from app.schemas import ImportResult, LeadCreate

# Accept the header spellings people actually have in their exports.
COLUMN_ALIASES: dict[str, str] = {
    "email": "email",
    "email address": "email",
    "e-mail": "email",
    "work email": "email",
    "first name": "first_name",
    "firstname": "first_name",
    "first": "first_name",
    "last name": "last_name",
    "lastname": "last_name",
    "last": "last_name",
    "full name": "_full_name",
    "name": "_full_name",
    "company": "company",
    "company name": "company",
    "organization": "company",
    "account": "company",
    "title": "title",
    "job title": "title",
    "position": "title",
    "phone": "phone",
    "phone number": "phone",
    "mobile": "phone",
    "website": "website",
    "url": "website",
    "domain": "website",
    "source": "source",
    "lead source": "source",
    "tags": "tags",
    "notes": "notes",
}

KNOWN_FIELDS = {
    "email",
    "first_name",
    "last_name",
    "company",
    "title",
    "phone",
    "website",
    "source",
    "tags",
    "notes",
}


def _normalize_header(header: str) -> str:
    key = header.strip().lower().replace("_", " ")
    return COLUMN_ALIASES.get(key, header.strip().lower().replace(" ", "_"))


def _split_name(full: str) -> tuple[str | None, str | None]:
    parts = full.strip().split()
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def import_leads_csv(db: Session, content: bytes, update_existing: bool = True) -> ImportResult:
    """Parse a CSV upload into leads. Unrecognized columns become custom fields."""
    result = ImportResult(created=0, updated=0, skipped=0)

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        result.errors.append("CSV has no header row")
        return result

    header_map = {name: _normalize_header(name) for name in reader.fieldnames}
    if "email" not in header_map.values():
        result.errors.append("CSV must contain an email column")
        return result

    seen_emails: set[str] = set()

    for line_no, raw_row in enumerate(reader, start=2):
        payload: dict = {}
        custom: dict = {}

        for original, value in raw_row.items():
            if original is None:
                continue
            field = header_map.get(original, "")
            value = (value or "").strip()
            if not value:
                continue

            if field == "_full_name":
                first, last = _split_name(value)
                payload.setdefault("first_name", first)
                payload.setdefault("last_name", last)
            elif field == "tags":
                payload["tags"] = [t.strip() for t in value.split(",") if t.strip()]
            elif field in KNOWN_FIELDS:
                payload[field] = value
            else:
                custom[field] = value

        email = (payload.get("email") or "").lower()
        if not email:
            result.skipped += 1
            result.errors.append(f"row {line_no}: missing email")
            continue

        if email in seen_emails:
            result.skipped += 1
            result.errors.append(f"row {line_no}: duplicate email in file ({email})")
            continue
        seen_emails.add(email)

        payload["email"] = email
        if custom:
            payload["custom_fields"] = custom

        try:
            parsed = LeadCreate(**payload)
        except ValidationError as exc:
            result.skipped += 1
            first_error = exc.errors()[0]
            result.errors.append(f"row {line_no}: {first_error['loc'][0]} {first_error['msg']}")
            continue

        existing = db.scalar(select(Lead).where(Lead.email == email))
        if existing:
            if not update_existing:
                result.skipped += 1
                continue
            # Only fill in fields the CSV actually supplied; never blank out data.
            for key, value in parsed.model_dump(exclude_unset=True).items():
                if key in {"status", "email"} or value in (None, [], {}):
                    continue
                if key == "custom_fields":
                    merged = dict(existing.custom_fields or {})
                    merged.update(value)
                    existing.custom_fields = merged
                else:
                    setattr(existing, key, value)
            result.updated += 1
        else:
            lead = Lead(**parsed.model_dump())
            db.add(lead)
            db.flush()
            db.add(
                Activity(
                    lead_id=lead.id,
                    type=ActivityType.created,
                    summary="Imported from CSV",
                    detail={"source": parsed.source or "csv"},
                )
            )
            result.created += 1

    db.commit()
    # Keep the response readable on a messy file.
    if len(result.errors) > 25:
        extra = len(result.errors) - 25
        result.errors = result.errors[:25] + [f"...and {extra} more issues"]
    return result
