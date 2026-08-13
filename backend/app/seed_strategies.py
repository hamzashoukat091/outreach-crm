"""Seed starter strategies: `python -m app.seed_strategies`.

These are starting points, meant to be edited on the Strategies page. Idempotent
by name, so re-running never clobbers an edited strategy.
"""

import logging

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Strategy

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("outreach.seed_strategies")

BASE_SYSTEM = (
    "You are an experienced B2B cold-outreach writer. You write short, specific, "
    "plain-spoken emails that a busy executive would actually finish reading. "
    "You never use marketing filler, you never flatter, and you never claim "
    "knowledge you were not given. A good email from you sounds like one competent "
    "person writing to another, not like a campaign."
)

STRATEGIES = [
    {
        "name": "Problem-first",
        "description": "Leads with a problem the role owns, then a light ask. Good all-rounder.",
        "system_prompt": BASE_SYSTEM,
        "instructions": (
            "Write a first-touch cold email.\n\n"
            "1. Open with one sentence that shows why you are writing to THIS person, "
            "based on their role or their company's own description. No 'I hope this "
            "finds you well', no compliments.\n"
            "2. Name one concrete problem someone in their exact role tends to own. "
            "Be specific to the role, not generic 'efficiency' language.\n"
            "3. One sentence on how that problem usually gets solved. Do not name "
            "customers or invent numbers.\n"
            "4. Close with a low-friction ask: a yes/no question or a request for a "
            "15-minute call. One ask only.\n\n"
            "Sign off as 'Hamza'."
        ),
        "tone": "Direct, peer-to-peer, no hype",
        "max_words": 130,
        "subject_hint": "Under 8 words, lowercase, specific, no clickbait and no emoji",
        "is_default": True,
    },
    {
        "name": "Intent-signal led",
        "description": "Uses the research-signal topics when present. Best for complete rows.",
        "system_prompt": BASE_SYSTEM,
        "instructions": (
            "Write a first-touch cold email that connects to the research signals in "
            "the context, if any are present.\n\n"
            "IMPORTANT: the signals tell you what topics the company appears to care "
            "about right now. Use them to choose your ANGLE. Never state or imply that "
            "you know what they have been researching or browsing -- that is intrusive "
            "and you cannot verify it.\n\n"
            "1. Open on the theme the signal points to, framed as a trend you see in "
            "their industry or role.\n"
            "2. Connect that theme to something their role would own day to day.\n"
            "3. One sentence on what a first step usually looks like.\n"
            "4. Close with a single 15-minute ask.\n\n"
            "If no signals are present, fall back to their job title and write a "
            "role-focused email instead. Sign off as 'Hamza'."
        ),
        "tone": "Consultative and informed, never presumptuous",
        "max_words": 150,
        "subject_hint": "Reference the theme, not the company name. Under 8 words.",
        "is_default": False,
    },
    {
        "name": "Role-only (thin context)",
        "description": "For prospects with no company data. Credible on job title alone.",
        "system_prompt": BASE_SYSTEM,
        "instructions": (
            "You have the person's job title and little or nothing about their company. "
            "Write an email that is credible on the strength of their ROLE alone.\n\n"
            "1. Open by naming the role directly and one responsibility that role "
            "genuinely carries.\n"
            "2. Describe one problem that is common for people in that role. Speak in "
            "terms of what is typical, not what you claim to know about them.\n"
            "3. Offer one concrete, useful thought -- something they could act on even "
            "if they never reply.\n"
            "4. Close with a soft ask: is this something you're dealing with?\n\n"
            "Do NOT speculate about their company's size, product, customers, or "
            "challenges. Do not name their company more than once. Keep it short -- "
            "a thin email that is honest beats a long one that guesses. "
            "Sign off as 'Hamza'."
        ),
        "tone": "Modest, useful, low-pressure",
        "max_words": 110,
        "subject_hint": "Speak to the role, e.g. 'question for a head of engineering'",
        "is_default": False,
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        created = 0
        for payload in STRATEGIES:
            exists = db.scalar(select(Strategy).where(Strategy.name == payload["name"]))
            if exists:
                continue
            db.add(Strategy(**payload))
            created += 1

        if created:
            db.commit()
            logger.info("Seeded %s strategies.", created)
        else:
            logger.info("Strategies already present; nothing to do.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
