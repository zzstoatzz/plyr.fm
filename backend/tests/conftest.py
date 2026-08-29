"""pytest configuration for relay tests."""

import asyncio
import contextlib
import os
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Generator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from io import BytesIO
from typing import BinaryIO
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
import redis as sync_redis_lib
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
from backend.storage.keys import AudioKey, StagedUploadKey
from backend.storage.r2 import R2Storage
from backend.utilities.redis import clear_client_cache

# the suite's scope/collection assertions are written against the production
# namespace; pin it so a developer's backend/.env (e.g. fm.plyr.dev) can't
# leak in. CI runs with no .env and is unaffected.
settings.atproto.app_namespace = "fm.plyr"


"""hosts the suite is allowed to create schemas in, truncate, and clone."""
_LOCAL_TEST_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", ""})
_ALLOW_REMOTE = "ALLOW_REMOTE_TEST_DATABASE"


def _require_local_test_database(database_url: str) -> None:
    """refuse to run the suite against a database that isn't local.

    conftest takes its base URL from `settings.database.url`, which loads
    `backend/.env` — so a developer whose `.env` points at neon (the normal
    setup for local work against dev) would have the suite run `create_all`,
    `_truncate_tables`, and `CREATE DATABASE` against a real cloud database.
    the compose stack would be started, waited on, and ignored.

    `just test` now pins DATABASE_URL at the compose postgres, but that only
    fixes the invocation we control; this fixes the invariant.
    """
    if os.environ.get(_ALLOW_REMOTE) == "1":
        return
    if (host := urlsplit(database_url).hostname or "") in _LOCAL_TEST_HOSTS:
        return
    raise pytest.UsageError(
        f"refusing to run tests against non-local database host {host!r}.\n"
        f"the suite creates schemas, truncates tables, and clones databases.\n"
        f"run `just test` (which points DATABASE_URL at the compose postgres), "
        f"or set DATABASE_URL yourself.\n"
        f"if you really mean it, set {_ALLOW_REMOTE}=1."
    )


def _bootstrap_template_database_from_controller(config: pytest.Config) -> None:
    """bootstrap the template database in the xdist controller.

    the template build used to happen lazily in each worker's session fixture,
    which runs inside the first test's pytest-timeout budget (10s). on a cold
    postgres the creator's schema setup plus the advisory-lock queue routinely
    blew that budget: waiters timed out (poisoning their whole worker session),
    and a creator killed mid-bootstrap left a schemaless template that every
    other worker cloned — the "relation artists does not exist" cascades.

    the controller runs before any worker and outside any test timeout, so the
    build happens exactly once here; workers then only take the fast
    already-finalized path and clone.
    """
    if os.environ.get("PYTEST_XDIST_WORKER"):
        return  # worker process — the controller already did this
    if not getattr(config.option, "numprocesses", None):
        return  # single-process run uses the base database directly
    asyncio.run(_ensure_template_database(settings.database.url))


class MockStorage(R2Storage):
    """Mock storage for tests - no R2 credentials needed."""

    def __init__(self):
        # skip R2Storage.__init__ which requires credentials
        self.staged_parts: dict[str, dict[int, bytes]] = {}
        self.staged_objects: dict[str, bytes] = {}
        self.promoted: dict[str, tuple[str, bool]] = {}

    async def save(
        self,
        file: BinaryIO | BytesIO,
        filename: str,
        progress_callback: Callable[[float], None] | None = None,
    ) -> str:
        """Mock save - returns a fake file_id."""
        return "mock_file_id_123"

    async def get_url(
        self,
        file_id: str,
        *,
        file_type: str | None = None,
        extension: str | None = None,
    ) -> str | None:
        """Mock get_url - returns a fake URL."""
        return f"https://mock.r2.dev/{file_id}"

    async def delete(self, file_id: str, file_type: str | None = None) -> bool:
        """Mock delete."""
        return True

    async def delete_gated(self, file_id: str, file_type: str | None = None) -> bool:
        """Mock delete_gated."""
        return True

    async def save_gated(
        self,
        file: BinaryIO | BytesIO,
        filename: str,
        progress_callback: Callable[[float], None] | None = None,
    ) -> str:
        """Mock save_gated."""
        return "mock_gated_file_id_456"

    # in-memory multipart store so endpoint tests drive the real session contract
    async def begin_staged_upload(self, staged: StagedUploadKey) -> str:
        self.staged_parts[staged.key] = {}
        return f"multipart-{staged.upload_id}"

    async def put_staged_part(
        self,
        staged: StagedUploadKey,
        multipart_id: str,
        part_number: int,
        body: bytes,
    ) -> str:
        self.staged_parts[staged.key][part_number] = body
        return f'"etag-{part_number}"'

    async def complete_staged_upload(
        self, staged: StagedUploadKey, multipart_id: str
    ) -> int:
        parts = self.staged_parts.get(staged.key, {})
        if not parts:
            raise ValueError("no parts uploaded")
        numbers = sorted(parts)
        if numbers != list(range(1, numbers[-1] + 1)):
            raise ValueError("InvalidPart")
        body = b"".join(parts[n] for n in numbers)
        self.staged_objects[staged.key] = body
        del self.staged_parts[staged.key]
        return len(body)

    async def staged_part_numbers(
        self, staged: StagedUploadKey, multipart_id: str
    ) -> list[int]:
        return sorted(self.staged_parts.get(staged.key, {}))

    async def abort_staged_upload(
        self, staged: StagedUploadKey, multipart_id: str
    ) -> None:
        self.staged_parts.pop(staged.key, None)

    async def stream_staged(
        self, staged: StagedUploadKey, *, chunk_size: int = 1024 * 1024
    ) -> AsyncIterator[bytes]:
        body = self.staged_objects[staged.key]
        for start in range(0, len(body), chunk_size):
            yield body[start : start + chunk_size]

    async def promote_staged(
        self, staged: StagedUploadKey, audio: AudioKey, *, gated: bool
    ) -> None:
        self.promoted[audio.key] = (staged.key, gated)
        del self.staged_objects[staged.key]

    async def delete_staged(self, staged: StagedUploadKey) -> None:
        self.staged_objects.pop(staged.key, None)
        self.staged_parts.pop(staged.key, None)


def pytest_configure(config: pytest.Config) -> None:
    """Set mock storage before any test modules are imported."""
    import backend.storage

    _require_local_test_database(settings.database.url)

    # set _storage directly to prevent R2Storage initialization
    backend.storage._storage = MockStorage()

    _bootstrap_template_database_from_controller(config)


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
            await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.run_sync(Base.metadata.create_all)
            await _truncate_tables(conn)
            await _create_clear_database_procedure(conn)
    finally:
        await engine.dispose()


async def _ensure_template_database(base_url: str) -> str:
    """ensure template database exists, is migrated, and is FINALIZED.

    uses an advisory lock to coordinate concurrent callers, and postgres's
    `datistemplate` flag as a bootstrap-complete marker: the flag is set only
    after the schema and helper procedure are in place, so a bootstrap killed
    partway (e.g. by a test timeout) leaves the flag unset and the next caller
    drops the partial database and rebuilds instead of cloning a schemaless
    template — the failure mode behind whole-worker "relation does not exist"
    cascades.

    returns the template database name.
    """
    base_db_name = _database_from_url(base_url)
    template_db_name = f"{base_db_name}_template"
    postgres_url = _postgres_admin_url(base_url)

    conn = await asyncpg.connect(postgres_url)
    try:
        # advisory lock prevents race condition between workers
        await conn.execute("SELECT pg_advisory_lock(hashtext($1))", template_db_name)
        try:
            finalized = await conn.fetchval(
                "SELECT datistemplate FROM pg_database WHERE datname = $1",
                template_db_name,
            )

            if finalized is False:
                # exists but never finalized — a previous bootstrap was
                # interrupted between CREATE DATABASE and schema setup
                await conn.execute(f'DROP DATABASE IF EXISTS "{template_db_name}"')
                finalized = None

            if finalized is None:
                await conn.execute(f'CREATE DATABASE "{template_db_name}"')

                # build URL for template and set it up
                scheme, netloc, _, query, fragment = urlsplit(base_url)
                template_url = urlunsplit(
                    (scheme, netloc, f"/{template_db_name}", query, fragment)
                )
                await _setup_template_database(template_url)

                await conn.execute(
                    f'ALTER DATABASE "{template_db_name}" IS_TEMPLATE true'
                )
        finally:
            # release even on failure so other workers aren't stuck waiting
            # for this connection to close
            await conn.execute(
                "SELECT pg_advisory_unlock(hashtext($1))", template_db_name
            )

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
            await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.run_sync(Base.metadata.create_all)
            await _truncate_tables(conn)
            await _create_clear_database_procedure(conn)
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def _database_setup(test_database_url: str) -> None:
    """marker fixture - database is set up by test_database_url fixture.

    deliberately NOT autouse: `check-oauth-scope-universe` runs a DB-free test
    file as a pre-commit hook, with no postgres anywhere, and autouse here
    would make every pytest invocation require one.

    the consequence is that a test whose *code under test* opens its own
    session must still request a db fixture — `test_database_url` is what
    repoints `settings.database.url` at this worker's database, so without it
    the session goes to the unpatched base URL. that URL has a schema serially
    and never under xdist, where the base database is only the source the
    template was built from, which is why the asymmetry reads as
    `relation "artists" does not exist` and only in parallel.
    """
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


@pytest.fixture(scope="session")
def fastapi_app() -> Generator[FastAPI, None, None]:
    """provides the FastAPI app with a test lifespan that skips docket worker.

    docket Worker binds asyncio.Tasks to the TestClient's portal loop; under
    xdist, session teardown runs on a different loop → RuntimeError. no test
    needs a live worker (all docket usage is mocked), so skip it.
    """
    from backend.main import app as main_app

    original_lifespan = main_app.router.lifespan_context
    main_app.router.lifespan_context = _test_lifespan
    yield main_app
    main_app.router.lifespan_context = original_lifespan


@asynccontextmanager
async def _test_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """test lifespan — skips docket worker to avoid event loop issues."""
    from backend._internal import jam_service, notification_service, queue_service

    await notification_service.setup()
    await queue_service.setup()
    await jam_service.setup()

    yield

    for service in (notification_service, queue_service, jam_service):
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(service.shutdown(), timeout=2.0)


@pytest.fixture(scope="session")
def client(fastapi_app: FastAPI) -> Generator[TestClient, None, None]:
    """provides a TestClient for testing the FastAPI application.

    session-scoped to avoid the overhead of starting the full lifespan
    (database init, services) for each test.
    """
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

    if redis is not available, silently skips - tests that actually need redis
    will fail on their own with a more specific error.
    """
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

    # try to flush db before tests - if redis unavailable, skip silently
    try:
        client = sync_redis_lib.Redis.from_url(new_url, socket_connect_timeout=1)
        client.flushdb()
        client.close()
    except sync_redis_lib.ConnectionError:
        # redis not available - tests that need it will fail with specific errors
        yield
        return

    yield

    # flush db after tests and clear cached clients
    clear_client_cache()
    try:
        client = sync_redis_lib.Redis.from_url(new_url, socket_connect_timeout=1)
        client.flushdb()
        client.close()
    except sync_redis_lib.ConnectionError:
        pass  # redis went away during tests, nothing to clean up
