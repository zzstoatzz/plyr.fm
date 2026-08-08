"""Exercise the Zig-owned list projection migration against relay_test only."""

from __future__ import annotations

import os
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command

PRIOR_REVISION = "4aaed6c819f1"
HEAD_REVISION = "7f1f760c57c1"
EXPECTED_TABLES = {"list_members", "list_records", "repo_heads"}
EXPECTED_HEAD_COLUMNS = {
    "repo_did",
    "commit_rev",
    "commit_cid",
    "data_cid",
    "indexed_at_us",
}


def sync_database_url() -> str:
    """Return the configured test URL with a synchronous psycopg driver."""
    raw = os.environ["DATABASE_URL"]
    return (
        make_url(raw)
        .set(drivername="postgresql+psycopg")
        .render_as_string(hide_password=False)
    )


def assert_test_database_and_drop_schema(database_url: str) -> None:
    """Refuse destructive work anywhere except the disposable relay_test DB."""
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            database_name = connection.scalar(text("SELECT current_database()"))
            if database_name != "relay_test":
                raise RuntimeError(f"unsafe migration test database: {database_name!r}")
            connection.execute(text("DROP SCHEMA IF EXISTS plyr_index CASCADE"))
    finally:
        engine.dispose()


def projected_tables(database_url: str) -> set[str]:
    """Return tables currently present in the dedicated projection schema."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'plyr_index'"
                )
            )
            return {str(row[0]) for row in rows}
    finally:
        engine.dispose()


def projection_schema_exists(database_url: str) -> bool:
    """Return whether the dedicated projection schema currently exists."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            return bool(
                connection.scalar(
                    text(
                        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata "
                        "WHERE schema_name = 'plyr_index')"
                    )
                )
            )
    finally:
        engine.dispose()


def repo_head_columns(database_url: str) -> set[str]:
    """Return the exact durable chain-state columns created by the head."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'plyr_index' "
                    "AND table_name = 'repo_heads'"
                )
            )
            return {str(row[0]) for row in rows}
    finally:
        engine.dispose()


def main() -> None:
    """Apply, inspect, and reverse the migration through the real Alembic env."""
    database_url = sync_database_url()
    assert_test_database_and_drop_schema(database_url)

    backend_dir = Path(__file__).resolve().parents[2] / "backend"
    config = Config(backend_dir / "alembic.ini")
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.stamp(config, PRIOR_REVISION, purge=True)

    upgraded = False
    try:
        command.upgrade(config, HEAD_REVISION)
        upgraded = True
        if not projection_schema_exists(database_url):
            raise AssertionError("migration did not create plyr_index schema")
        tables = projected_tables(database_url)
        if tables != EXPECTED_TABLES:
            raise AssertionError(f"unexpected plyr_index tables: {sorted(tables)!r}")
        columns = repo_head_columns(database_url)
        if columns != EXPECTED_HEAD_COLUMNS:
            raise AssertionError(f"unexpected repo_heads columns: {sorted(columns)!r}")
    finally:
        if upgraded:
            command.downgrade(config, PRIOR_REVISION)
        else:
            assert_test_database_and_drop_schema(database_url)

    if projection_schema_exists(database_url):
        raise AssertionError("migration downgrade left plyr_index schema")
    if remaining := projected_tables(database_url):
        raise AssertionError(f"migration downgrade left tables: {sorted(remaining)!r}")


if __name__ == "__main__":
    main()
