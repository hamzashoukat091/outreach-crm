#!/bin/sh
set -e

echo "Running migrations..."
alembic upgrade head

# Starter strategies (openers + reply handlers) are always seeded (idempotent
# by name) so the AI composer is usable immediately after import. The old demo
# lead seeder went with the leads layer.
python -m app.seed_strategies

echo "Starting API on :8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
