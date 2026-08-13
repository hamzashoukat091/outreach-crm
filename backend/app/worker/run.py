"""Background sender.

Runs as its own compose service. A single loop process is the right size for an
MVP -- no broker to operate -- and the SKIP LOCKED claim in process_due_sends
means scaling to multiple replicas later requires no code change.
"""

import logging
import signal
import sys
import time
from types import FrameType

from app.core.config import settings
from app.core.db import SessionLocal
from app.services.engine import process_due_sends

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
)
logger = logging.getLogger("outreach.worker")

_running = True


def _shutdown(signum: int, _frame: FrameType | None) -> None:
    global _running
    logger.info("received signal %s, finishing current tick then exiting", signum)
    _running = False


def main() -> int:
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    logger.info(
        "worker started (interval=%ss, batch=%s, cap=%s/day, driver=%s)",
        settings.worker_interval_seconds,
        settings.send_batch_size,
        settings.daily_send_cap,
        settings.mail_driver,
    )

    while _running:
        db = SessionLocal()
        try:
            process_due_sends(db)
        except Exception:  # noqa: BLE001 - a bad tick must not kill the loop
            logger.exception("tick failed; retrying next interval")
            db.rollback()
        finally:
            db.close()

        # Sleep in slices so SIGTERM is honored promptly.
        for _ in range(settings.worker_interval_seconds):
            if not _running:
                break
            time.sleep(1)

    logger.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
