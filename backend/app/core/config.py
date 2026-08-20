from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://outreach:outreach@db:5432/outreach"

    # Mail delivery. driver=console logs the message instead of sending it,
    # which keeps a fresh checkout from mailing real people by accident.
    mail_driver: str = "console"  # console | smtp
    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = False
    mail_from: str = "outreach@example.com"
    mail_from_name: str = "Outreach"

    # Mailpit's REST API, used by the dev inbox poller (Mailpit speaks no
    # IMAP). Only consulted when AutomationSettings.imap_host is empty.
    mailpit_api_url: str = "http://mailpit:8025"

    # Worker cadence and guardrails.
    worker_interval_seconds: int = 15
    daily_send_cap: int = 200
    send_batch_size: int = 25

    # AI generation. Left empty, the generate endpoints return a clear error
    # rather than failing deep in the client library.
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    cors_origins: str = "http://localhost:3000"

    # The login. Empty means the gate refuses everyone rather than admitting
    # everyone -- fail closed, not open, if the env goes missing.
    auth_username: str = ""
    auth_password: str = ""

    # Marks the session cookie Secure, so browsers refuse to send it over
    # plain http. Off by default because local development is http://
    # localhost; production sets it true behind TLS.
    session_cookie_secure: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
