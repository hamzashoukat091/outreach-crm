#!/bin/sh
set -e

echo "Running migrations..."
alembic upgrade head

if [ "$SEED_ON_START" = "true" ]; then
  echo "Seeding demo data..."
  python -m app.seed
fi

# Starter strategies are always seeded (idempotent by name) so the AI composer
# is usable immediately after import.
python -m app.seed_strategies

echo "Starting API on :8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
