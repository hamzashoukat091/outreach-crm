import logging
import smtplib
from abc import ABC, abstractmethod
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("outreach.mailer")


class MailerError(Exception):
    pass


class Mailer(ABC):
    @abstractmethod
    def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleMailer(Mailer):
    """Default driver: logs the message and delivers nothing.

    This is what makes `docker compose up` safe on a fresh clone -- no
    configuration mistake can put mail in front of a real person.
    """

    def send(self, to: str, subject: str, body: str) -> None:
        logger.info(
            "[dry-run] would send to=%s subject=%s\n%s\n%s",
            to,
            subject,
            "-" * 60,
            body,
        )


class SmtpMailer(Mailer):
    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"] = f"{settings.mail_from_name} <{settings.mail_from}>"
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)

        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
                if settings.smtp_use_tls:
                    server.starttls()
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
        except Exception as exc:  # noqa: BLE001 - surfaced to the send row
            raise MailerError(str(exc)) from exc


def get_mailer() -> Mailer:
    if settings.mail_driver == "smtp":
        return SmtpMailer()
    return ConsoleMailer()
