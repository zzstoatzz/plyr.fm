"""pytest configuration for relay tests."""

from collections.abc import AsyncGenerator, Generator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

import asyncpg
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


def _database_from_url(url: str) -> str:
    """extract database name from connection URL."""
    _, _, path, _, _ = urlsplit(url)
    return path.strip("/")


def _postgres_admin_url(database_url: str) -> str:
    """convert async database URL to sync postgres URL for admin operations."""
    scheme, netloc, _, query, fragment = urlsplit(database_url)
    # asyncpg -> postgres for direct connection
    scheme = scheme.replace("+asyncpg", "").replace("postgresql", "postgres")
    return urlunsplit((scheme, netloc, "/postgres", query, fragment))


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


async def _setup_template_database(template_url: str) -> None:
    """initialize database schema and helper procedure on template database."""
    engine = create_async_engine(template_url, echo=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _truncate_tables(conn)
            await _create_clear_database_procedure(conn)
    finally:
        await engine.dispose()


async def _ensure_template_database(base_url: str) -> str:
    """ensure template database exists and is migrated.

    uses advisory lock to coordinate between xdist workers.
    returns the template database name.
    """
    base_db_name = _database_from_url(base_url)
    template_db_name = f"{base_db_name}_template"
    postgres_url = _postgres_admin_url(base_url)

    conn = await asyncpg.connect(postgres_url)
    try:
        # advisory lock prevents race condition between workers
        await conn.execute("SELECT pg_advisory_lock(hashtext($1))", template_db_name)

        # check if template exists
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", template_db_name
        )

        if not exists:
            # create template database
            await conn.execute(f'CREATE DATABASE "{template_db_name}"')

            # build URL for template and set it up
            scheme, netloc, _, query, fragment = urlsplit(base_url)
            template_url = urlunsplit(
                (scheme, netloc, f"/{template_db_name}", query, fragment)
            )
            await _setup_template_database(template_url)

        # release lock (other workers waiting will see template exists)
        await conn.execute("SELECT pg_advisory_unlock(hashtext($1))", template_db_name)

        return template_db_name
    finally:
        await conn.close()


async def _create_worker_database_from_template(
    base_url: str, worker_id: str, template_db_name: str
) -> str:
    """create worker database by cloning the template (instant file copy)."""
    base_db_name = _database_from_url(base_url)
    worker_db_name = f"{base_db_name}_{worker_id}"
    postgres_url = _postgres_admin_url(base_url)

    conn = await asyncpg.connect(postgres_url)
    try:
        # kill connections to worker db (if it exists from previous run)
        await conn.execute(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
            """,
            worker_db_name,
        )

        # kill connections to template db (required for cloning)
        await conn.execute(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()
            """,
            template_db_name,
        )

        # drop and recreate from template (instant - just file copy)
        await conn.execute(f'DROP DATABASE IF EXISTS "{worker_db_name}"')
        await conn.execute(
            f'CREATE DATABASE "{worker_db_name}" WITH TEMPLATE "{template_db_name}"'
        )

        return worker_db_name
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def test_database_url(worker_id: str) -> str:
    """generate a unique test database URL for each pytest worker.

    uses template database pattern for fast parallel test execution:
    1. first worker creates template db with migrations (once)
    2. each worker clones from template (instant file copy)

    also patches settings.database.url so all production code uses test db.
    """
    import asyncio
    import os

    base_url = settings.database.url

    # single worker - just use base database
    if worker_id == "master":
        asyncio.run(_setup_database_direct(base_url))
        return base_url

    # xdist workers - use template pattern
    template_db_name = asyncio.run(_ensure_template_database(base_url))
    asyncio.run(
        _create_worker_database_from_template(base_url, worker_id, template_db_name)
    )

    # build URL for worker database
    scheme, netloc, _, query, fragment = urlsplit(base_url)
    base_db_name = _database_from_url(base_url)
    worker_db_name = f"{base_db_name}_{worker_id}"
    worker_url = urlunsplit((scheme, netloc, f"/{worker_db_name}", query, fragment))

    # patch settings so all production code uses this URL
    # this is safe because each xdist worker is a separate process
    settings.database.url = worker_url
    os.environ["DATABASE_URL"] = worker_url

    return worker_url


async def _setup_database_direct(database_url: str) -> None:
    """set up database directly (for single worker mode)."""
    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _truncate_tables(conn)
            await _create_clear_database_procedure(conn)
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def _database_setup(test_database_url: str) -> None:
    """marker fixture - database is set up by test_database_url fixture."""
    _ = test_database_url  # ensure dependency chain


@pytest.fixture()
async def _engine(
    test_database_url: str, _database_setup: None
) -> AsyncGenerator[AsyncEngine, None]:
    """create a database engine for each test (to avoid event loop issues)."""
    from backend.utilities.database import ENGINES

    # clear any cached engines from previous tests
    for cached_engine in list(ENGINES.values()):
        await cached_engine.dispose()
    ENGINES.clear()

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
        # clean up cached engines
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


def _redis_db_for_worker(worker_id: str) -> int:
    """determine redis database number based on xdist worker id.

    uses different DB numbers for each worker to isolate parallel tests:
    - master/gw0: db 1
    - gw1: db 2
    - gw2: db 3
    - etc.

    db 0 is reserved for local development.
    """
    if worker_id == "master" or not worker_id:
        return 1
    if "gw" in worker_id:
        return 1 + int(worker_id.replace("gw", ""))
    return 1


def _redis_url_with_db(base_url: str, db: int) -> str:
    """replace database number in redis URL."""
    # redis://host:port/db -> redis://host:port/{new_db}
    if "/" in base_url.rsplit(":", 1)[-1]:
        # has db number, replace it
        base = base_url.rsplit("/", 1)[0]
        return f"{base}/{db}"
    else:
        # no db number, append it
        return f"{base_url}/{db}"


@pytest.fixture(scope="session", autouse=True)
def redis_database(worker_id: str) -> Generator[None, None, None]:
    """use isolated redis databases for parallel test execution.

    each xdist worker gets its own redis database to prevent cache pollution
    between tests running in parallel. flushes the db before and after tests.
    """
    import os

    from backend.config import settings
    from backend.utilities.redis import clear_client_cache

    # skip if no redis configured
    if not settings.docket.url:
        yield
        return

    db = _redis_db_for_worker(worker_id)
    new_url = _redis_url_with_db(settings.docket.url, db)

    # patch settings for this worker process
    settings.docket.url = new_url
    os.environ["DOCKET_URL"] = new_url

    # clear any cached clients (they have old URL)
    clear_client_cache()

    # flush db before tests
    import redis

    sync_redis = redis.Redis.from_url(new_url)
    sync_redis.flushdb()
    sync_redis.close()

    yield

    # flush db after tests and clear cached clients
    clear_client_cache()
    sync_redis = redis.Redis.from_url(new_url)
    sync_redis.flushdb()
    sync_redis.close()
