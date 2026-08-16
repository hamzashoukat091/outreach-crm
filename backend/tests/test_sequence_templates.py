"""Templates: applying one must produce a working, fully-owned sequence."""

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.automation_sequences import (
    apply_sequence_template,
    list_sequence_templates,
)
from app.models import Sequence, SequenceStep, Strategy
from app.services.sequence_templates import BY_KEY, TEMPLATES


def seed_strategy(db, name):
    strategy = Strategy(
        name=name,
        kind="opener",
        system_prompt="sys",
        instructions="do the thing",
    )
    db.add(strategy)
    db.flush()
    return strategy


def test_every_template_has_a_day_zero_first_step():
    """Step 1 fires on enrollment; a wait there would silently delay it."""
    for template in TEMPLATES:
        assert template.steps, f"{template.key} has no steps"
        assert template.steps[0].wait_days == 0, template.key


def test_template_keys_are_unique():
    keys = [t.key for t in TEMPLATES]
    assert len(keys) == len(set(keys))


def test_apply_builds_steps_in_order_with_strategies(db):
    template = BY_KEY["standard-3"]
    for step in template.steps:
        seed_strategy(db, step.strategy_name)

    out = apply_sequence_template("standard-3", None, db=db)

    steps = db.scalars(
        select(SequenceStep)
        .where(SequenceStep.sequence_id == out.id)
        .order_by(SequenceStep.position)
    ).all()
    assert [s.position for s in steps] == [1, 2, 3]
    assert [s.wait_days for s in steps] == [
        t.wait_days for t in template.steps
    ]
    assert all(s.strategy_id is not None for s in steps)
    # Per-step instructions are the whole reason a follow-up does not repeat
    # the opener's angle, so they must survive the copy.
    assert steps[1].step_instructions


def test_apply_without_the_strategy_leaves_the_step_unset(db):
    """A renamed angle must not abort the whole template."""
    out = apply_sequence_template("single", None, db=db)

    step = db.scalar(select(SequenceStep).where(SequenceStep.sequence_id == out.id))
    assert step is not None
    assert step.strategy_id is None


def test_applying_twice_does_not_produce_two_identical_names(db):
    """Two sequences with the same name are indistinguishable in a dropdown."""
    first = apply_sequence_template("single", None, db=db)
    second = apply_sequence_template("single", None, db=db)

    assert first.name != second.name
    assert second.name.startswith(first.name)


def test_unknown_template_is_404(db):
    with pytest.raises(HTTPException) as excinfo:
        apply_sequence_template("does-not-exist", None, db=db)
    assert excinfo.value.status_code == 404


def test_listing_reports_which_strategies_are_missing(db):
    seed_strategy(db, "3-sentence opener (start a conversation)")

    rows = {t.key: t for t in list_sequence_templates(db=db)}

    # The seeded angle is the only one present, so 'single' is complete...
    assert rows["single"].missing_strategies == []
    # ...while a multi-angle template reports the rest as missing.
    assert "Breakup (close the loop)" in rows["standard-3"].missing_strategies


def test_applied_sequence_is_independent_of_the_template(db):
    """Editing a created sequence must not need the template to agree."""
    out = apply_sequence_template("standard-3", None, db=db)
    sequence = db.get(Sequence, out.id)

    sequence.name = "My own name"
    db.flush()

    assert BY_KEY["standard-3"].name == "Standard 3-step"
