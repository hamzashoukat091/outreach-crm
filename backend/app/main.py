import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    analytics,
    dashboard,
    drafts,
    enrollments,
    leads,
    prospects,
    sender,
    sequences,
    strategies,
)
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
)

app = FastAPI(
    title="Outreach CRM",
    description="Cold-outreach lead CRM with email sequencing.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router)
app.include_router(sequences.router)
app.include_router(enrollments.router)
app.include_router(dashboard.router)

# Prospect / AI-generation side of the app.
app.include_router(prospects.router)
app.include_router(sender.router)
app.include_router(strategies.router)
app.include_router(drafts.router)
app.include_router(analytics.router)


@app.get("/health", tags=["ops"])
def health():
    return {
        "status": "ok",
        "mail_driver": settings.mail_driver,
        # Surfaced so the UI can warn before a generate call fails.
        "ai_configured": bool(settings.anthropic_api_key),
        "model": settings.anthropic_model,
    }
