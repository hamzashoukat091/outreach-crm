"""Parser tests built around the real export's quirks."""

from app.services.prospect_import import parse_row

FULL_ROW = {
    "row_num": "1",
    "contact_professions_email": "Christina.Ross@CubeSoftware.com",
    "contact_professional_email_status": "valid",
    "prospect_first_name": "Christina",
    "prospect_last_name": "Ross",
    "prospect_job_title": "Chief executive officer & founder",
    "prospect_job_seniority_level": '["owner"]',
    "prospect_skills": '["Strategy","Finance"]',
    "business_name": "Cube",
    "business_domain": "cubesoftware.com",
    "business_business_description": "FP&A software.",
    "business_naics_description": "Software Publishers",
    "business_number_of_employees_range": "[51-200]",
    "business_yearly_revenue_range": "[10M-25M]",
    "business_business_intent_topics": '[{"topic":"ai automation","score":90}]',
    "contact_emails": '[{"address":"christina.ross@cubesoftware.com","type":"current_professional"},{"address":"c@gmail.com","type":"personal"}]',
    "prospect_id": "abc123",
    "business_id": "biz123",
}

# The shape that makes up 40% of the sample: contact data, no company block.
SPARSE_ROW = {
    "row_num": "20",
    "contact_professions_email": "shruti@nayya.com",
    "contact_professional_email_status": "valid",
    "prospect_first_name": "",
    "prospect_last_name": "Venkatesh",
    "prospect_job_title": "Vice president of engineering",
    "prospect_job_seniority_level": '["vp"]',
    "business_name": "",
    "business_domain": "",
    "business_business_description": "",
    "business_naics_description": "",
    "business_number_of_employees_range": "",
    "contact_emails": '[{"address":"shruti@nayya.com","type":"current_professional"}]',
    "prospect_id": "xyz789",
}


def test_full_row_parses_every_field():
    payload, error = parse_row(FULL_ROW, 2)

    assert error is None
    assert payload["email"] == "christina.ross@cubesoftware.com"  # lowercased
    assert payload["company_name"] == "Cube"
    assert payload["is_complete"] is True
    assert payload["missing_fields"] == []
    assert payload["company_inferred"] is False


def test_bracket_wrapped_scalars_are_unwrapped():
    payload, _ = parse_row(FULL_ROW, 2)

    assert payload["seniority"] == "owner"          # from ["owner"]
    assert payload["employee_range"] == "51-200"    # from [51-200]
    assert payload["revenue_range"] == "10M-25M"


def test_json_columns_become_lists():
    payload, _ = parse_row(FULL_ROW, 2)

    assert payload["skills"] == ["Strategy", "Finance"]
    assert payload["intent_topics"] == [{"topic": "ai automation", "score": 90}]


def test_personal_emails_are_kept_separately():
    payload, _ = parse_row(FULL_ROW, 2)
    assert payload["other_emails"] == ["c@gmail.com"]


def test_sparse_row_is_flagged_not_dropped():
    payload, error = parse_row(SPARSE_ROW, 21)

    assert error is None
    assert payload["email"] == "shruti@nayya.com"
    assert payload["is_complete"] is False
    assert "company_description" in payload["missing_fields"]


def test_company_is_recovered_from_the_email_domain():
    payload, _ = parse_row(SPARSE_ROW, 21)

    assert payload["company_domain"] == "nayya.com"
    assert payload["company_name"] == "Nayya"
    # The flag is what stops a derived name being treated as verified.
    assert payload["company_inferred"] is True


def test_row_without_email_is_rejected():
    payload, error = parse_row({"prospect_job_title": "CEO"}, 5)

    assert payload is None
    assert "no email" in error


def test_malformed_email_is_rejected_with_the_row_number():
    payload, error = parse_row({"contact_professions_email": "not-an-email"}, 7)

    assert payload is None
    assert "row 7" in error


def test_email_falls_back_to_contact_emails_list():
    row = {
        "contact_professions_email": "",
        "contact_emails": '[{"address":"fallback@acme.com","type":"current_professional"}]',
    }
    payload, error = parse_row(row, 3)

    assert error is None
    assert payload["email"] == "fallback@acme.com"


def test_unmapped_columns_are_preserved():
    row = {**SPARSE_ROW, "some_new_vendor_column": "keep me"}
    payload, _ = parse_row(row, 21)

    assert payload["extra"]["some_new_vendor_column"] == "keep me"


def test_empty_json_placeholders_do_not_count_as_data():
    row = {**SPARSE_ROW, "prospect_skills": "[]", "prospect_interests": "null"}
    payload, _ = parse_row(row, 21)

    assert "skills" not in payload
    assert "interests" not in payload


def test_malformed_json_degrades_instead_of_failing():
    row = {**FULL_ROW, "prospect_skills": "Strategy, Finance, Leadership"}
    payload, error = parse_row(row, 2)

    assert error is None
    assert payload["skills"] == ["Strategy", "Finance", "Leadership"]
