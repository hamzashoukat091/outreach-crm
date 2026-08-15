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


SENDER = SimpleNamespace(
    name="Hamza",
    headline="Python AI Engineer",
    offer="I build AI agents and RAG systems in Python.",
    proof="4+ years; FastAPI, LangChain, AWS.",
    call_to_action="A short call",
    signature="Hamza",
    is_configured=True,
)


def test_sender_offer_reaches_the_prompt():
    """Without this the model knows the prospect but not what is being sold."""
    _system, message = build_prompt(make_prospect(), STRATEGY, SENDER)

    assert "ABOUT THE SENDER" in message
    assert "I build AI agents and RAG systems" in message
    assert "Sign off as: Hamza" in message


def test_guardrails_forbid_agency_voice_and_invented_credentials():
    _system, message = build_prompt(make_prospect(), STRATEGY, SENDER)

    assert 'never "we"' in message
    assert "ONE INDEPENDENT PERSON" in message
    # The rule wraps across lines in the source, so match a single-line fragment.
    assert "Describe only the skills and services given in ABOUT THE SENDER" in message


def test_missing_sender_profile_says_so_rather_than_inventing():
    _system, message = build_prompt(make_prospect(), STRATEGY, None)

    assert "No sender profile has been filled in" in message
    assert "rather than inventing services" in message


def test_five_part_strategy_carries_its_full_structure():
    """The seeded default encodes a specific cold-email structure; if any part
    is dropped the emails silently regress to a generic pitch."""
    from app.seed_strategies import STRATEGIES

    five_part = next(s for s in STRATEGIES if s["is_default"])
    instructions = five_part["instructions"]

    for section in (
        "SUBJECT LINE",
        "INTRODUCE YOURSELF",
        "VALUE PROPOSITION",
        "HANDLE THE OBJECTION",
        "EXTEND, THEN ASK",
    ):
        assert section in instructions

    # The objection must be derived per prospect -- the list spans technical
    # leaders and non-technical owners, so a hardcoded one would misfire.
    assert "my own team could build this" in instructions
    assert "not for a business like mine" in instructions

    # Length has to allow the structure; the shorter strategies cannot fit it.
    assert five_part["max_words"] >= 200


def test_three_sentence_strategy_enforces_its_shape():
    """Brevity is the whole strategy here -- if the sentence count or the
    reply-not-a-meeting rule is lost, it becomes just another short pitch."""
    from app.seed_strategies import STRATEGIES

    short = next(s for s in STRATEGIES if s["name"].startswith("3-sentence"))

    assert "EXACTLY THREE SENTENCES" in short["instructions"]
    assert "Not four. Not two." in short["instructions"]
    # The ask must be answerable, not a booking request.
    assert "Never ask for a meeting" in short["instructions"]
    assert "REPLY, not a booking" in short["instructions"]
    # Filler subject lines read as a mass send.
    assert "never a filler word" in short["subject_hint"].lower()
    # Three sentences cannot fit the long structures.
    assert short["max_words"] <= 80


def test_free_demo_strategy_offers_real_work_not_a_sketch():
    """The hook is building something that runs. If it degrades into 'I have
    some ideas' or an audit offer, it becomes ordinary bait."""
    from app.seed_strategies import STRATEGIES

    demo = next(s for s in STRATEGIES if s["name"].startswith("Free working demo"))
    instructions = demo["instructions"]

    assert "EXACTLY THREE SENTENCES" in instructions
    assert "actually BUILD" in instructions
    # Sales language undoes the gesture.
    for banned in ("no obligation", "free consultation", "proof of concept"):
        assert banned in instructions  # named so the model avoids them
    # The demo must not require access to their systems to build.
    assert "must work from what is publicly available" in instructions
    # Reply, not a booking.
    assert "Never ask for a call" in instructions


def test_strategies_span_short_and_long_openers():
    """The set should offer both a conversation opener and a full pitch."""
    from app.seed_strategies import STRATEGIES

    lengths = [s["max_words"] for s in STRATEGIES]
    assert min(lengths) <= 80
    assert max(lengths) >= 200


def test_only_one_seeded_strategy_is_default():
    from app.seed_strategies import STRATEGIES

    assert sum(1 for s in STRATEGIES if s["is_default"]) == 1


def test_career_history_is_not_sent_to_the_model():
    """The vendor supplies experience as unordered title fragments with no
    company or dates, so a stale 'Owner' can read as a current role."""
    prospect = make_prospect(
        experience=["Director software development", "Director", "Owner"]
    )
    text, _quality, used = build_context(prospect)

    assert "Career history" not in text
    assert "experience" not in used


def test_skills_are_capped_to_keep_signal_dense():
    prospect = make_prospect(skills=[f"Skill{i}" for i in range(20)])
    text, _quality, _used = build_context(prospect)

    assert "Skill7" in text
    assert "Skill8" not in text


def test_subject_hint_is_dropped_when_instructions_already_cover_it():
    """Two near-identical subject rules invite the model to average them."""
    strategy = SimpleNamespace(
        system_prompt="You are a writer.",
        instructions="1. SUBJECT LINE - keep it oblique.\n2. Body.",
        tone=None,
        max_words=200,
        subject_hint="Under 8 words",
        name="Five part",
    )
    _system, message = build_prompt(make_prospect(), strategy, None)

    assert "Subject line guidance:" not in message
    # The strategy's own, more detailed rule survives.
    assert "SUBJECT LINE - keep it oblique" in message


def test_guardrail_points_at_the_context_it_means():
    _system, message = build_prompt(make_prospect(), STRATEGY, None)

    # The context sits above the guardrails, so "below" was simply wrong.
    assert "PROSPECT CONTEXT above" in message


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


def test_prompt_is_reproducible_from_its_parts():
    """The stored prompt must equal what build_prompt produced, so the
    inspector shows the real call rather than a re-derived approximation."""
    prospect = make_prospect()
    system, message = build_prompt(prospect, STRATEGY)

    # Every ingested field the context claims to use appears in the message.
    _text, _quality, used = build_context(prospect)
    for value in used.values():
        assert str(value)[:40] in message

    assert system == STRATEGY.system_prompt.strip()


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
