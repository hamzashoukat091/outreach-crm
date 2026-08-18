import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    analytics,
    auth,
    automation_admin,
    automation_messages,
    automation_sequences,
    dashboard,
    drafts,
    prospects,
    sender,
    strategies,
)
from app.core.config import settings
from app.core.gate import AuthGateMiddleware

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
)

app = FastAPI(
    title="Outreach CRM",
    description="Cold-outreach lead CRM with email sequencing.",
    version="0.1.0",
)

app.add_middleware(AuthGateMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(dashboard.router)

# Prospect / AI-generation side of the app (manual outreach).
app.include_router(prospects.router)
app.include_router(sender.router)
app.include_router(strategies.router)
app.include_router(drafts.router)
app.include_router(analytics.router)

# Sequences automation layer.
app.include_router(automation_sequences.router)
app.include_router(automation_messages.router)
app.include_router(automation_admin.router)


@app.get("/health", tags=["ops"])
def health():
    return {
        "status": "ok",
        "mail_driver": settings.mail_driver,
        # Surfaced so the UI can warn before a generate call fails.
        "ai_configured": bool(settings.anthropic_api_key),
        "model": settings.anthropic_model,
    }
