"""Ready-made sequence shapes.

A template is a starting point, not a managed object: applying one creates a
normal sequence you then own and edit. Nothing links back, so changing a
template later never mutates sequences someone already built from it.

Steps reference strategies BY NAME rather than by id. Names are what the
seeded strategies are stable on, and a template that hard-coded ids would
break on any database but the one it was written against. A name that
matches nothing yet is created from `fallback_*` text, so a preset always
produces a working sequence -- but an existing strategy with that name is
reused untouched, because the user's edits to their own prompts outrank
anything shipped here.
"""

from dataclasses import dataclass, field

# Angles the presets lean on, in the order a reader would expect them.
OPENER_3_SENTENCE = "3-sentence opener (start a conversation)"
OPENER_DEMO = "Free working demo (3 sentences)"
OPENER_BREAKUP = "Breakup (close the loop)"
OPENER_INTENT = "Intent-signal led"
OPENER_PROBLEM = "Problem-first"
OPENER_ROLE_ONLY = "Role-only (thin context)"
OPENER_ASK_FIRST = "Ask first, then build (open a conversation)"


@dataclass(frozen=True)
class TemplateStep:
    strategy_name: str
    # Days after the PREVIOUS step. Step 1 is always 0 (it goes on enrollment).
    wait_days: int
    step_instructions: str | None = None


@dataclass(frozen=True)
class SequenceTemplate:
    key: str
    name: str
    summary: str
    # Who this shape is for -- shown under the name so the choice is made on
    # fit rather than on step count.
    best_for: str
    steps: list[TemplateStep] = field(default_factory=list)

    @property
    def total_days(self) -> int:
        return sum(s.wait_days for s in self.steps)


# Reused verbatim across templates: the instruction that stops a follow-up
# from re-introducing the sender or re-running the opener's angle.
_FOLLOW_UP_RULES = (
    "They did not reply to the previous email. Do not repeat its angle and do "
    "not re-introduce yourself. Open by referring back briefly in a few words, "
    "then make this email's point concretely."
)

_BREAKUP_RULES = (
    "They have not replied to any previous email. Refer to what was already "
    "offered, make it easy to say no, and close the loop without guilt-tripping "
    "or asking again. This is the last email in the sequence."
)


TEMPLATES: list[SequenceTemplate] = [
    SequenceTemplate(
        key="single",
        name="Single email",
        summary="One email, no follow-up.",
        best_for=(
            "Testing whether a vertical replies at all before spending "
            "follow-up effort on it. 10 leads is a test, not a campaign."
        ),
        steps=[TemplateStep(OPENER_3_SENTENCE, 0)],
    ),
    SequenceTemplate(
        key="standard-3",
        name="Standard 3-step",
        summary="Short question, then a free working demo, then a clean exit.",
        best_for=(
            "The safe default for any vertical. Escalates what is offered, "
            "never the pressure."
        ),
        steps=[
            TemplateStep(OPENER_3_SENTENCE, 0),
            TemplateStep(
                OPENER_DEMO,
                3,
                _FOLLOW_UP_RULES
                + " Name the one specific thing you would build for THIS "
                "business, based on what their role or company actually does. "
                "Ask only for a yes to build it, not for a call.",
            ),
            TemplateStep(OPENER_BREAKUP, 5, _BREAKUP_RULES),
        ],
    ),
    SequenceTemplate(
        key="intent-led",
        name="Intent-led 3-step",
        summary="Opens on their buying signal, then demo, then exit.",
        best_for=(
            "Verticals where the export carried real intent topics -- SaaS and "
            "marketing agencies have the richest signal data."
        ),
        steps=[
            TemplateStep(OPENER_INTENT, 0),
            TemplateStep(
                OPENER_DEMO,
                4,
                _FOLLOW_UP_RULES
                + " The first email led with the signal they are already "
                "researching; this one turns that into something concrete you "
                "would build for them.",
            ),
            TemplateStep(OPENER_BREAKUP, 5, _BREAKUP_RULES),
        ],
    ),
    SequenceTemplate(
        key="ask-first",
        name="Ask first, then build",
        summary="Ask what eats their time, then build whatever they describe.",
        best_for=(
            "Businesses whose real bottleneck you cannot guess from a company "
            "description -- the reply tells you what to build instead."
        ),
        steps=[
            TemplateStep(OPENER_ASK_FIRST, 0),
            TemplateStep(
                OPENER_DEMO,
                4,
                _FOLLOW_UP_RULES
                + " The first email asked what takes up their time and got no "
                "answer, so stop asking and name one concrete thing you would "
                "build for THIS business instead. Do not repeat the question.",
            ),
            TemplateStep(OPENER_BREAKUP, 5, _BREAKUP_RULES),
        ],
    ),
    SequenceTemplate(
        key="patient-4",
        name="Patient 4-touch",
        summary="Four emails spread over three weeks.",
        best_for=(
            "Senior buyers who do not answer fast sequences -- law firm "
            "partners, practice owners, founders."
        ),
        steps=[
            TemplateStep(OPENER_3_SENTENCE, 0),
            TemplateStep(
                OPENER_PROBLEM,
                4,
                _FOLLOW_UP_RULES
                + " Lead with the specific problem their role owns, not with "
                "what you sell.",
            ),
            TemplateStep(
                OPENER_DEMO,
                7,
                _FOLLOW_UP_RULES
                + " Two emails have gone unanswered, so make this one purely "
                "about what they get: name the thing you would build, free, "
                "with no call required.",
            ),
            TemplateStep(OPENER_BREAKUP, 10, _BREAKUP_RULES),
        ],
    ),
    SequenceTemplate(
        key="thin-context",
        name="Thin-context 2-step",
        summary="Credible on job title alone, then one follow-up.",
        best_for=(
            "Imports where the company block came back empty -- the rows the "
            "prospect list flags as 'Needs company info'."
        ),
        steps=[
            TemplateStep(OPENER_ROLE_ONLY, 0),
            TemplateStep(
                OPENER_BREAKUP,
                4,
                _BREAKUP_RULES
                + " You know little about their company, so keep it about the "
                "role and keep it short.",
            ),
        ],
    ),
]

BY_KEY = {t.key: t for t in TEMPLATES}
