"""pytest configuration for relay tests."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.orm import sessionmaker

from relay.models import Base


@asynccontextmanager
async def session_context(engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """create a database session context, matching Nebula's pattern."""
    async_session_maker = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with async_session_maker() as session:
        yield session


async def _create_clear_database_procedure(
    connection: AsyncConnection,
) -> None:
    """creates a stored procedure in the test database used for quickly clearing
    the database between tests.

    this follows the pattern used in Nebula - delete only data created after test start.
    """
    # get all tables in dependency order (reversed for deletion)
    tables = list(reversed(Base.metadata.sorted_tables))

    def schema(table: sa.Table) -> str:
        return table.schema or "public"

    def timestamp_column(table: sa.Table) -> str | None:
        """find the timestamp column to use for filtering"""
        if "created_at" in table.columns:
            return "created_at"
        elif "updated_at" in table.columns:
            return "updated_at"
        else:
            # if no timestamp column, delete all rows
            return None

    delete_statements = []
    for table in tables:
        ts_col = timestamp_column(table)
        if ts_col:
            delete_statements.append(
                f"""
                BEGIN
                    DELETE FROM {schema(table)}.{table.name}
                    WHERE {ts_col} > _test_start_time;
                EXCEPTION WHEN OTHERS THEN
                    RAISE EXCEPTION 'Error clearing table {schema(table)}.{table.name}: %', SQLERRM;
                END;
                """
            )
        else:
            # no timestamp column - delete all rows
            delete_statements.append(
                f"""
                BEGIN
                    DELETE FROM {schema(table)}.{table.name};
                EXCEPTION WHEN OTHERS THEN
                    RAISE EXCEPTION 'Error clearing table {schema(table)}.{table.name}: %', SQLERRM;
                END;
                """
            )

    deletes = "\n".join(delete_statements)

    signature = "clear_database(_test_start_time timestamptz)"
    procedure_body = f"""
    CREATE PROCEDURE {signature}
    LANGUAGE PLPGSQL
    AS $$
        BEGIN
        {deletes}
        END;
    $$;
    """

    await connection.execute(sa.text(f"DROP PROCEDURE IF EXISTS {signature};"))
    await connection.execute(sa.text(procedure_body))


@pytest.fixture(scope="session")
def test_database_url(worker_id: str) -> str:
    """generate a unique test database URL for each pytest worker.

    uses port 5433 which maps to the test database in tests/docker-compose.yml.
    """
    base_url = "postgresql+asyncpg://relay_test:relay_test@localhost:5433/relay_test"

    # for parallel test execution, append worker id to database name
    if worker_id == "master":
        return base_url

    # worker_id will be "gw0", "gw1", etc for xdist workers
    return f"{base_url}_{worker_id}"


async def _setup_database(test_database_url: str) -> None:
    """initialize database schema and helper procedure."""
    engine = create_async_engine(test_database_url, echo=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _create_clear_database_procedure(conn)
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def _database_setup(test_database_url: str):
    """create tables and stored procedures once per test session."""
    import asyncio

    asyncio.run(_setup_database(test_database_url))
    try:
        yield
    finally:
        # nothing to tear down; procedure is idempotent and tables persist for session
        pass


@pytest.fixture()
async def _engine(test_database_url: str, _database_setup: None) -> AsyncEngine:
    """create a database engine for each test (to avoid event loop issues)."""
    return create_async_engine(
        test_database_url,
        echo=False,
    )


@pytest.fixture()
async def _clear_db(_engine: AsyncEngine) -> AsyncGenerator[None, None]:
    """clear the database after each test.

    this fixture must be yielded before the session fixture to prevent locking.
    """
    start_time = datetime.now(UTC)

    try:
        yield
    finally:
        # clear the database after the test
        async with _engine.begin() as conn:
            await conn.execute(
                sa.text("CALL clear_database(:start_time)"),
                {"start_time": start_time},
            )


@pytest.fixture
async def db_session(
    _engine: AsyncEngine, _clear_db: None
) -> AsyncGenerator[AsyncSession, None]:
    """provide a database session for each test.

    the _clear_db fixture is used as a dependency to ensure proper cleanup order.
    """
    async with session_context(engine=_engine) as session:
        yield session
