"""pytest configuration for relay tests."""

from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.orm import sessionmaker

from backend.config import settings
from backend.models import Base


class MockStorage:
    """Mock storage for tests - no R2 credentials needed."""

    async def save(self, file_obj, filename: str, progress_callback=None) -> str:
        """Mock save - returns a fake file_id."""
        return "mock_file_id_123"

    async def get_url(
        self, file_id: str, file_type: str | None = None, extension: str | None = None
    ) -> str:
        """Mock get_url - returns a fake URL."""
        return f"https://mock.r2.dev/{file_id}"

    async def delete(self, file_id: str, extension: str | None = None) -> None:
        """Mock delete."""


def pytest_configure(config):
    """Set mock storage before any test modules are imported."""
    import backend.storage

    # set _storage directly to prevent R2Storage initialization
    backend.storage._storage = MockStorage()  # type: ignore[assignment]


@asynccontextmanager
async def session_context(engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """create a database session context."""
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
    """
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


async def _truncate_tables(connection: AsyncConnection) -> None:
    """truncate all tables to ensure a clean slate at start of session."""
    # get all table names from metadata
    tables = [table.name for table in Base.metadata.sorted_tables]
    if not tables:
        return

    # truncate all tables with cascade to handle foreign keys
    # restart identity resets auto-increment counters
    stmt = f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE;"
    await connection.execute(sa.text(stmt))


@pytest.fixture(scope="session")
def test_database_url(worker_id: str) -> str:
    """generate a unique test database URL for each pytest worker.

    reads from settings.database.url and appends worker suffix if needed.
    """
    base_url = settings.database.url

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
            await _truncate_tables(conn)
            await _create_clear_database_procedure(conn)
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def _database_setup(test_database_url: str) -> None:
    """create tables and stored procedures once per test session."""
    import asyncio

    asyncio.run(_setup_database(test_database_url))


@pytest.fixture()
async def _engine(
    test_database_url: str, _database_setup: None
) -> AsyncGenerator[AsyncEngine, None]:
    """create a database engine for each test (to avoid event loop issues)."""
    engine = create_async_engine(
        test_database_url,
        echo=False,
        pool_size=2,
        max_overflow=0,
    )
    try:
        yield engine
    finally:
        await engine.dispose()
        # also dispose any engines cached by production code (database.py)
        # to prevent connection accumulation across tests
        from backend.utilities.database import ENGINES

        for cached_engine in list(ENGINES.values()):
            await cached_engine.dispose()
        ENGINES.clear()


@pytest.fixture()
async def _clear_db(_engine: AsyncEngine) -> AsyncGenerator[None, None]:
    """clear the database after each test."""
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


@pytest.fixture
def fastapi_app() -> FastAPI:
    """provides the FastAPI app instance."""
    from backend.main import app as main_app

    return main_app


@pytest.fixture
def client(fastapi_app: FastAPI) -> Generator[TestClient, None, None]:
    """provides a TestClient for testing the FastAPI application."""
    with TestClient(fastapi_app) as tc:
        yield tc
