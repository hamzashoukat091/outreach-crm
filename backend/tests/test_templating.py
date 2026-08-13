from types import SimpleNamespace

from app.services.templating import render, render_for_lead


def make_lead(**overrides):
    base = dict(
        email="dana@northwind.com",
        first_name="Dana",
        last_name="Whitfield",
        company="Northwind",
        title="VP Ops",
        phone=None,
        website=None,
        source=None,
        custom_fields={"city": "Spokane"},
    )
    base.update(overrides)
    lead = SimpleNamespace(**base)
    lead.full_name = f"{base['first_name']} {base['last_name']}".strip()
    return lead


def test_renders_merge_fields():
    text, missing = render("Hi {{first_name}} at {{company}}", {"first_name": "Dana", "company": "Northwind"})
    assert text == "Hi Dana at Northwind"
    assert missing == []


def test_tolerates_whitespace_in_token():
    text, _ = render("Hi {{  first_name  }}", {"first_name": "Dana"})
    assert text == "Hi Dana"


def test_missing_field_renders_empty_and_is_reported():
    text, missing = render("Hi {{first_name}}, {{unknown}}", {"first_name": "Dana"})
    assert text == "Hi Dana, "
    assert missing == ["unknown"]


def test_blank_value_counts_as_missing():
    _text, missing = render("Hi {{first_name}}", {"first_name": ""})
    assert missing == ["first_name"]


def test_custom_fields_are_namespaced():
    lead = make_lead()
    subject, body, missing = render_for_lead("Hello", "You're in {{custom.city}}", lead)
    assert body == "You're in Spokane"
    assert missing == []


def test_render_for_lead_collects_missing_across_subject_and_body():
    lead = make_lead(company=None)
    _s, _b, missing = render_for_lead("About {{company}}", "Hi {{first_name}}, re {{company}}", lead)
    # Reported once even though it appears twice.
    assert missing == ["company"]
