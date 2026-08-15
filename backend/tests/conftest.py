import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
import app.models  # noqa: F401 - register tables

# Tests need a real Postgres because the schema uses JSONB and enum types.
TEST_DB_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+psycopg://outreach:outreach@db:5432/outreach_test"
)


@pytest.fixture(scope="session")
def engine():
    admin_url = TEST_DB_URL.rsplit("/", 1)[0] + "/postgres"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    db_name = TEST_DB_URL.rsplit("/", 1)[1]

    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": db_name}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    admin.dispose()

    eng = create_engine(TEST_DB_URL)
    # Rebuild from current metadata every run. A schema-level reset rather
    # than drop_all(): drop_all only knows the CURRENT models, so tables from
    # removed layers (with FKs into surviving ones) would block the drop and
    # poison every run against an older test database.
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    """Each test runs in a transaction that is rolled back afterwards.

    The engine code under test calls session.commit(). Binding the session to an
    already-open connection-level transaction and restarting a SAVEPOINT after
    each commit keeps those commits from escaping the test, so the outer
    rollback still cleans everything up.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = sessionmaker(bind=connection, join_transaction_mode="create_savepoint", future=True)()

    yield session

    session.close()
    transaction.rollback()
    connection.close()
