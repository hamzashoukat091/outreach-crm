from types import SimpleNamespace

from app.services.generator import _parse_response, build_context, build_prompt


def make_prospect(**overrides):
    base = dict(
        first_name="Christina",
        last_name="Ross",
        email="christina@cube.com",
        job_title="Chief executive officer",
        job_department=None,
        seniority="owner",
        prospect_city="new york",
        prospect_region=None,
        skills=["Strategy", "Finance"],
        interests=[],
        experience=[],
        company_name="Cube",
        company_website="cubesoftware.com",
        company_domain="cubesoftware.com",
        company_description="FP&A software for finance teams.",
        company_city=None,
        company_region=None,
        industry="Software Publishers",
        employee_range="51-200",
        revenue_range="10M-25M",
        intent_topics=[{"topic": "ai automation", "score": 90}],
        company_inferred=False,
    )
    base.update(overrides)
    prospect = SimpleNamespace(**base)
    prospect.full_name = f"{base['first_name'] or ''} {base['last_name'] or ''}".strip()
    return prospect


STRATEGY = SimpleNamespace(
    system_prompt="You are a writer.",
    instructions="Write a short email.",
    tone="Direct",
    max_words=120,
    subject_hint="Short",
    name="Test",
)


def test_rich_context_is_marked_rich():
    _text, quality, used = build_context(make_prospect())

    assert quality == "rich"
    assert used["company_name"] == "Cube"
    assert "description" in used


def test_missing_company_marks_context_thin():
    prospect = make_prospect(
        company_description=None, industry=None, employee_range=None, revenue_range=None
    )
    _text, quality, _used = build_context(prospect)

    assert quality == "thin"


def test_thin_context_carries_an_explicit_warning():
    prospect = make_prospect(
        company_description=None, industry=None, employee_range=None
    )
    text, _quality, _used = build_context(prospect)

    assert "CONTEXT IS LIMITED" in text
    assert "Do not speculate" in text


def test_inferred_company_is_labelled_as_derived():
    """The model must not treat a domain-derived name as verified knowledge."""
    prospect = make_prospect(
        company_name="Nayya",
        company_domain="nayya.com",
        company_description=None,
        industry=None,
        employee_range=None,
        company_inferred=True,
    )
    text, quality, _used = build_context(prospect)

    assert quality == "thin"
    assert "inferred from their email domain" in text
    assert "nothing else about the business is known" in text


def test_intent_topics_are_ranked_and_qualified():
    prospect = make_prospect(
        intent_topics=[
            {"topic": "low signal", "score": 20},
            {"topic": "high signal", "score": 95},
        ]
    )
    text, _quality, _used = build_context(prospect)

    # Highest score first, and never presented as verified browsing history.
    assert text.index("high signal") < text.index("low signal")
    assert "do NOT claim to know" in text


def test_guardrails_are_always_appended():
    _system, message = build_prompt(make_prospect(), STRATEGY)

    assert "Never invent a metric" in message
    assert "Do not guess" in message
    assert "SUBJECT:" in message


def test_strategy_instructions_reach_the_prompt():
    _system, message = build_prompt(make_prospect(), STRATEGY)

    assert "Write a short email." in message
    assert "120 words" in message


def test_long_company_description_is_truncated():
    prospect = make_prospect(company_description="word " * 500)
    text, _quality, _used = build_context(prospect)

    assert "…" in text
    assert len(text) < 4000


def test_response_parsing_splits_subject_and_body():
    subject, body = _parse_response("SUBJECT: quick question\nBODY:\nHi there,\n\nThanks.")

    assert subject == "quick question"
    assert body.startswith("Hi there,")


def test_response_parsing_survives_a_missing_body_marker():
    subject, body = _parse_response("SUBJECT: hello\nHi there, this is the email.")

    assert subject == "hello"
    assert "Hi there" in body


def test_empty_subject_falls_back_rather_than_shipping_blank():
    subject, _body = _parse_response("BODY:\nJust a body with no subject line.")

    assert subject
    assert subject != ""
