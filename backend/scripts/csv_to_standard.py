"""Rewrite a vendor CSV export into the CRM's column names.

The importer accepts one spelling per field (see prospect_import.COLUMN_MAP)
rather than a list of vendor aliases, because an exporter that renames its
columns otherwise imports rows with no company data -- which is worse than a
rejection, since the emails still generate, just generically.

This converts a file exported under the older vendor names. Point it at the
CSV and it writes a `-standard.csv` alongside:

    python backend/scripts/csv_to_standard.py prospects_raw.csv

Columns it does not recognise are dropped, and it says which.
"""

import argparse
import csv
import json
import pathlib
import sys

# Vendor column -> CRM column. Both the old "business_"-prefixed export and
# the newer "prospect_company_" one are covered, so either converts.
RENAMES: dict[str, str] = {
    # identity
    "contact_professions_email": "email",
    "contact_professional_email": "email",
    "contact_professional_email_status": "email_status",
    "prospect_first_name": "first_name",
    "prospect_last_name": "last_name",
    "prospect_job_title": "job_title",
    "prospect_job_department": "job_department",
    "prospect_job_seniority_level": "seniority",
    "prospect_linkedin": "linkedin",
    "prospect_city": "city",
    "prospect_region_name": "region",
    "prospect_country_name": "country",
    "prospect_skills": "skills",
    "prospect_interests": "interests",
    # company, older export
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
    # company, newer export
    "prospect_company_name": "company_name",
    "prospect_company_website": "company_website",
    "prospect_company_linkedin": "company_linkedin",
    # bookkeeping
    "prospect_id": "prospect_ref",
    "business_id": "business_ref",
    "row_num": "row_num",
    "created_at": "created_at",
}

# Recognised but not carried across: the CRM has nowhere to put them.
DROP = {
    "prospect_full_name",
    "prospect_experience",
    "contact_emails",
    "contact_mobile_phone",
    "contact_phone_numbers",
    "business_logo",
    "business_naics",
    "business_sic_code",
    "business_sic_code_description",
    "business_business_intent_topics",
    "company_linkedin",
}


def flatten(value: str) -> str:
    """A JSON array of strings -> a comma-separated list.

    The importer parses either, but a plain list is readable in a spreadsheet,
    which is the point of converting at all.
    """
    text = (value or "").strip()
    if not (text.startswith("[") and text.endswith("]")):
        return text
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        # Not JSON, but still bracketed -- the export writes ranges as a bare
        # [11-50], which is neither a JSON array nor a value anyone wants to
        # read in a spreadsheet.
        return text[1:-1].strip().strip('"').strip()
    if isinstance(parsed, list):
        flat = [str(p).strip() for p in parsed if isinstance(p, (str, int, float))]
        return ", ".join(flat)
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="the vendor CSV to convert")
    parser.add_argument("-o", "--out", help="output path (default: <source>-standard.csv)")
    args = parser.parse_args()

    src = pathlib.Path(args.source)
    if not src.exists():
        print(f"No such file: {src}", file=sys.stderr)
        return 1
    dest = pathlib.Path(args.out) if args.out else src.with_name(f"{src.stem}-standard.csv")

    with src.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            print("That file has no header row.", file=sys.stderr)
            return 1

        headers = [(h or "").strip().lower() for h in reader.fieldnames]
        mapped: dict[str, str] = {}
        unknown: list[str] = []
        for header in headers:
            target = RENAMES.get(header)
            if target and target not in DROP:
                mapped[header] = target
            elif header not in DROP and header not in RENAMES:
                unknown.append(header)

        if "email" not in mapped.values():
            print(
                "No email column found. Expected one of: "
                + ", ".join(k for k, v in RENAMES.items() if v == "email"),
                file=sys.stderr,
            )
            return 1

        out_columns = list(dict.fromkeys(mapped.values()))
        rows = 0
        with dest.open("w", newline="", encoding="utf-8") as out:
            writer = csv.DictWriter(out, fieldnames=out_columns)
            writer.writeheader()
            for raw in reader:
                record = {}
                for source_col, target_col in mapped.items():
                    value = raw.get(source_col) or ""
                    record[target_col] = (
                        flatten(value)
                        if target_col in ("skills", "interests", "seniority", "employee_range", "revenue_range")
                        else value.strip()
                    )
                if not record.get("email", "").strip():
                    continue
                writer.writerow(record)
                rows += 1

    print(f"Wrote {rows} rows to {dest}")
    print(f"Columns: {', '.join(out_columns)}")
    if unknown:
        print(f"\nDropped {len(unknown)} unrecognised column(s): {', '.join(unknown)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
