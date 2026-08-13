"""Idempotent demo data: `python -m app.seed`."""

import logging

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import Activity, ActivityType, Lead, LeadStatus, Sequence, SequenceStep

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("outreach.seed")

LEADS = [
    ("dana@northwindlogistics.com", "Dana", "Whitfield", "Northwind Logistics", "VP Operations", LeadStatus.new, ["logistics", "midmarket"]),
    ("marcus@brightpathdental.com", "Marcus", "Ellery", "Brightpath Dental", "Practice Owner", LeadStatus.contacted, ["healthcare"]),
    ("s.okafor@vertexmanufacturing.com", "Sade", "Okafor", "Vertex Manufacturing", "Plant Manager", LeadStatus.new, ["manufacturing"]),
    ("liam@harborviewrealty.com", "Liam", "Castellanos", "Harborview Realty", "Managing Broker", LeadStatus.replied, ["real-estate"]),
    ("priya@lumenanalytics.io", "Priya", "Raghunathan", "Lumen Analytics", "Head of Growth", LeadStatus.qualified, ["saas", "warm"]),
    ("tom@cedarpeakoutfitters.com", "Tom", "Bergstrom", "Cedar Peak Outfitters", "Founder", LeadStatus.new, ["retail"]),
    ("ana@solsticeinteriors.com", "Ana", "Moreau", "Solstice Interiors", "Principal Designer", LeadStatus.contacted, ["design"]),
    ("dev@quantatechpartners.com", "Devansh", "Kapoor", "Quanta Tech Partners", "CTO", LeadStatus.new, ["saas"]),
    ("rachel@meridianlawgroup.com", "Rachel", "Adeyemi", "Meridian Law Group", "Partner", LeadStatus.won, ["legal"]),
    ("owen@fieldstonebrewing.com", "Owen", "Nakashima", "Fieldstone Brewing", "Operations Lead", LeadStatus.lost, ["food-bev"]),
]

SEQUENCE = {
    "name": "Cold Outreach — 3 Touch",
    "description": "Intro, value follow-up, and a short break-up note.",
    "steps": [
        (1, 0, "Quick question about {{company}}",
         "Hi {{first_name}},\n\nI came across {{company}} and noticed you're leading "
         "{{title}} work there. We help teams in your space cut the manual side of "
         "outreach so reps spend their time on live conversations instead.\n\n"
         "Worth a 15-minute look?\n\nBest,\nAlex"),
        (2, 3, "Re: {{company}} — one example",
         "Hi {{first_name}},\n\nFollowing up with something concrete: a team about the "
         "size of {{company}} cut their follow-up time roughly in half in the first "
         "month, mostly by never dropping a thread.\n\nOpen to a short call this week?"
         "\n\nBest,\nAlex"),
        (3, 7, "Closing the loop",
         "Hi {{first_name}},\n\nI don't want to keep filling your inbox, so this is my "
         "last note. If the timing isn't right, no problem at all — just reply "
         "'later' and I'll check back next quarter.\n\nThanks for your time,\nAlex"),
    ],
}


def main() -> None:
    db = SessionLocal()
    try:
        if db.scalar(select(func.count(Lead.id))):
            logger.info("Database already has leads; skipping seed.")
            return

        for email, first, last, company, title, status, tags in LEADS:
            lead = Lead(
                email=email,
                first_name=first,
                last_name=last,
                company=company,
                title=title,
                status=status,
                tags=tags,
                source="seed",
                custom_fields={"city": "Spokane"},
            )
            db.add(lead)
            db.flush()
            db.add(
                Activity(
                    lead_id=lead.id,
                    type=ActivityType.created,
                    summary="Lead created (seed data)",
                )
            )

        sequence = Sequence(name=SEQUENCE["name"], description=SEQUENCE["description"])
        for order, delay, subject, body in SEQUENCE["steps"]:
            sequence.steps.append(
                SequenceStep(step_order=order, delay_days=delay, subject=subject, body=body)
            )
        db.add(sequence)

        db.commit()
        logger.info("Seeded %s leads and 1 sequence.", len(LEADS))
    finally:
        db.close()


if __name__ == "__main__":
    main()
