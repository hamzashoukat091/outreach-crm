from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
import sqlalchemy as sa
from sqlalchemy import case, func, select
from sqlalchemy import true as sa_true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import DraftStatus, EmailDraft, Prospect, ProspectStatus
from app.schemas.prospects import (
    DayCount,
    NamedCount,
    ProspectAnalytics,
    StatusCount,
    StrategyPerformance,
)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Statuses that represent a real response to outreach.
POSITIVE = (ProspectStatus.replied, ProspectStatus.won)


def _top(db: Session, column, limit: int = 8) -> list[NamedCount]:
    rows = db.execute(
        select(column, func.count(Prospect.id))
        .where(column.isnot(None), column != "")
        .group_by(column)
        .order_by(func.count(Prospect.id).desc())
        .limit(limit)
    ).all()
    return [NamedCount(label=str(r[0]), count=r[1]) for r in rows]


@router.get("", response_model=ProspectAnalytics)
def get_analytics(days: int = Query(30, ge=7, le=180), db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Prospect.id))) or 0
    complete = (
        db.scalar(select(func.count(Prospect.id)).where(Prospect.is_complete.is_(True))) or 0
    )
    incomplete = total - complete

    status_rows = db.execute(
        select(Prospect.status, func.count(Prospect.id)).group_by(Prospect.status)
    ).all()
    status_counts = {r[0]: r[1] for r in status_rows}
    by_status = [
        StatusCount(status=s.value, count=status_counts.get(s, 0)) for s in ProspectStatus
    ]

    # Intent topics live in a JSONB array of {topic, score}. Unnest with a
    # lateral join so each topic can be grouped and ranked.
    # The unnested column must be typed JSONB for ->> subscripting to be valid.
    topic_element = (
        func.jsonb_array_elements(Prospect.intent_topics)
        .table_valued(sa.column("value", JSONB), joins_implicitly=False)
        .alias("intent")
    )
    topic_text = topic_element.c.value["topic"].astext
    intent_rows = db.execute(
        select(topic_text.label("topic"), func.count().label("n"))
        .select_from(Prospect)
        .join(topic_element, sa_true())
        .where(func.jsonb_array_length(Prospect.intent_topics) > 0)
        .group_by(topic_text)
        .order_by(func.count().desc())
        .limit(8)
    ).all()
    top_intent = [NamedCount(label=r[0], count=r[1]) for r in intent_rows if r[0]]

    total_drafts = db.scalar(
        select(func.count(EmailDraft.id)).where(EmailDraft.status != DraftStatus.discarded)
    ) or 0
    approved = db.scalar(
        select(func.count(EmailDraft.id)).where(EmailDraft.status == DraftStatus.approved)
    ) or 0
    approval_rate = round((approved / total_drafts) * 100, 1) if total_drafts else 0.0

    replied = sum(status_counts.get(s, 0) for s in POSITIVE)
    # Reply rate is measured against prospects actually emailed.
    contacted = (
        db.scalar(
            select(func.count(func.distinct(EmailDraft.prospect_id))).where(
                EmailDraft.status == DraftStatus.approved
            )
        )
        or 0
    )
    reply_rate = round((replied / contacted) * 100, 1) if contacted else 0.0

    # Does thin context actually produce worse emails? This is the question the
    # 40%-incomplete import raises, so measure it directly.
    quality_rows = db.execute(
        select(
            EmailDraft.context_quality,
            func.count(EmailDraft.id),
            func.sum(case((EmailDraft.status == DraftStatus.approved, 1), else_=0)),
        )
        .where(EmailDraft.status != DraftStatus.discarded)
        .group_by(EmailDraft.context_quality)
    ).all()

    thin_total = thin_ok = rich_total = rich_ok = 0
    for quality, count, ok in quality_rows:
        ok = int(ok or 0)
        if quality == "thin":
            thin_total, thin_ok = count, ok
        elif quality == "rich":
            rich_total, rich_ok = count, ok

    since = datetime.now(timezone.utc) - timedelta(days=days)
    # Group and order on the same expression object so Postgres accepts it in
    # the GROUP BY (a separately-built date_trunc() would not match).
    day_bucket = func.date_trunc("day", EmailDraft.created_at)
    activity_rows = db.execute(
        select(
            func.to_char(day_bucket, "YYYY-MM-DD"),
            func.count(EmailDraft.id),
            func.sum(case((EmailDraft.status == DraftStatus.approved, 1), else_=0)),
        )
        .where(EmailDraft.created_at >= since)
        .group_by(day_bucket)
        .order_by(day_bucket)
    ).all()
    activity = [
        DayCount(day=r[0], generated=r[1], approved=int(r[2] or 0)) for r in activity_rows
    ]

    perf_rows = db.execute(
        select(
            EmailDraft.strategy_id,
            func.coalesce(EmailDraft.strategy_name, "(deleted strategy)"),
            func.count(EmailDraft.id),
            func.sum(case((EmailDraft.status == DraftStatus.approved, 1), else_=0)),
            func.avg(EmailDraft.output_tokens),
        )
        .where(EmailDraft.status != DraftStatus.discarded)
        .group_by(EmailDraft.strategy_id, EmailDraft.strategy_name)
        .order_by(func.count(EmailDraft.id).desc())
    ).all()

    # Replies attributable to each strategy, via the approved draft that was sent.
    reply_rows = db.execute(
        select(EmailDraft.strategy_id, func.count(func.distinct(Prospect.id)))
        .join(Prospect, EmailDraft.prospect_id == Prospect.id)
        .where(
            EmailDraft.status == DraftStatus.approved,
            Prospect.status.in_(POSITIVE),
        )
        .group_by(EmailDraft.strategy_id)
    ).all()
    replies_by_strategy = {r[0]: r[1] for r in reply_rows}

    strategy_performance = []
    for sid, name, generated, ok, avg_tokens in perf_rows:
        ok = int(ok or 0)
        strategy_replies = replies_by_strategy.get(sid, 0)
        strategy_performance.append(
            StrategyPerformance(
                strategy_id=sid,
                name=name,
                generated=generated,
                approved=ok,
                approval_rate=round((ok / generated) * 100, 1) if generated else 0.0,
                replied=strategy_replies,
                reply_rate=round((strategy_replies / ok) * 100, 1) if ok else 0.0,
                avg_output_tokens=round(float(avg_tokens), 0) if avg_tokens else None,
            )
        )

    tokens = db.execute(
        select(
            func.coalesce(func.sum(EmailDraft.input_tokens), 0),
            func.coalesce(func.sum(EmailDraft.output_tokens), 0),
        )
    ).one()

    return ProspectAnalytics(
        total_prospects=total,
        complete=complete,
        incomplete=incomplete,
        data_completeness=round((complete / total) * 100, 1) if total else 0.0,
        by_status=by_status,
        by_seniority=_top(db, Prospect.seniority),
        by_industry=_top(db, Prospect.industry),
        by_employee_range=_top(db, Prospect.employee_range),
        top_intent_topics=top_intent,
        total_drafts=total_drafts,
        approved_drafts=approved,
        approval_rate=approval_rate,
        replied_count=replied,
        reply_rate=reply_rate,
        thin_context_drafts=thin_total,
        rich_context_drafts=rich_total,
        thin_approval_rate=round((thin_ok / thin_total) * 100, 1) if thin_total else 0.0,
        rich_approval_rate=round((rich_ok / rich_total) * 100, 1) if rich_total else 0.0,
        activity=activity,
        strategy_performance=strategy_performance,
        total_input_tokens=int(tokens[0]),
        total_output_tokens=int(tokens[1]),
    )
