"""Seed starter strategies: `python -m app.seed_strategies`.

These are starting points, meant to be edited on the Strategies page. Idempotent
by name, so re-running never clobbers an edited strategy.

The voice throughout is one independent specialist writing to a decision-maker.
Not an agency, not a team, no "we".
"""

import logging

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Strategy

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("outreach.seed_strategies")

BASE_SYSTEM = (
    "You write cold outreach on behalf of one independent specialist who sells "
    "their own skills and services directly. You are not an agency and never "
    "speak as a company -- always 'I', never 'we'. You write short, specific, "
    "plain-spoken emails that a busy decision-maker would actually finish "
    "reading. No marketing filler, no flattery, and never a claim of experience "
    "you were not given. A good email from you reads like a capable individual "
    "who understands the recipient's problem, not like a campaign."
)

STRATEGIES = [
    {
        "name": "Problem-first",
        "description": "Leads with a problem their role owns, then offers your help. Good all-rounder.",
        "system_prompt": BASE_SYSTEM,
        "instructions": (
            "Write a first-touch cold email offering your services.\n\n"
            "1. Open with one sentence showing why you're writing to THIS person, "
            "based on their role or their company's own description. No 'I hope "
            "this finds you well', no compliments.\n"
            "2. Name one concrete problem someone in their exact role tends to "
            "own — something your skills actually address. Be specific to the "
            "role, not generic 'efficiency' language.\n"
            "3. Say plainly what you do about that problem, drawing only on the "
            "skills listed in ABOUT THE SENDER. One sentence.\n"
            "4. Close with a low-friction ask: a yes/no question or a short call. "
            "One ask only.\n\n"
            "Write as an individual offering their own work. Never imply a team, "
            "a company, or clients you were not told about."
        ),
        "tone": "Direct, peer-to-peer, no hype",
        "max_words": 130,
        "subject_hint": "Under 8 words, lowercase, specific, no clickbait and no emoji",
        "is_default": True,
    },
    {
        "name": "Intent-signal led",
        "description": "Uses the research-signal topics to pick the angle. Best for complete rows.",
        "system_prompt": BASE_SYSTEM,
        "instructions": (
            "Write a first-touch cold email that connects your skills to the "
            "research signals in the context, if any are present.\n\n"
            "IMPORTANT: the signals show what topics the company appears to care "
            "about right now. Use them to choose your ANGLE. Never state or imply "
            "that you know what they have been researching — you cannot verify it "
            "and saying so is intrusive.\n\n"
            "1. Open on the theme the signal points to, framed as something you "
            "see happening in their industry or role.\n"
            "2. Connect that theme to work you can actually do, using only the "
            "skills in ABOUT THE SENDER.\n"
            "3. One sentence on what a first step together would look like.\n"
            "4. Close with a single short-call ask.\n\n"
            "If no signals are present, fall back to their job title and write a "
            "role-focused email instead."
        ),
        "tone": "Consultative and informed, never presumptuous",
        "max_words": 150,
        "subject_hint": "Reference the theme, not the company name. Under 8 words.",
        "is_default": False,
    },
    {
        "name": "Role-only (thin context)",
        "description": "For prospects with no company data. Credible on their job title alone.",
        "system_prompt": BASE_SYSTEM,
        "instructions": (
            "You have the person's job title and little or nothing about their "
            "company. Write an email that is credible on their ROLE alone.\n\n"
            "1. Open by naming the role directly and one responsibility it "
            "genuinely carries.\n"
            "2. Describe one problem common to people in that role which your "
            "skills address. Speak in terms of what is typical, not what you "
            "claim to know about them.\n"
            "3. Offer one concrete, useful thought — something they could act on "
            "even if they never reply.\n"
            "4. Close with a soft ask: is this something you're dealing with?\n\n"
            "Do NOT speculate about their company's size, product, customers, or "
            "challenges. Name their company at most once. A short honest email "
            "beats a long one that guesses."
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
