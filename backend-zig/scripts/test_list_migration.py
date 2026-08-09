"""Exercise the Zig-owned projection migrations against relay_test only."""

from __future__ import annotations

import os
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command

PRIOR_REVISION = "4aaed6c819f1"
HEAD_REVISION = "e6b08d3f2a71"
EXPECTED_TABLES = {
    "account_availability",
    "list_members",
    "list_records",
    "profile_records",
    "relay_cursors",
    "repo_heads",
    "track_records",
}
EXPECTED_AVAILABILITY_COLUMNS = {
    "available",
    "commit_cid",
    "evidence_source",
    "observed_at_us",
    "pds_origin",
    "repo_did",
    "repository_rev",
    "unavailable_reason",
}
EXPECTED_HEAD_COLUMNS = {
    "repo_did",
    "commit_rev",
    "commit_cid",
    "data_cid",
    "indexed_at_us",
}
EXPECTED_CURSOR_COLUMNS = {"source", "seq", "updated_at_us"}
EXPECTED_TRACK_COLUMNS = {
    "album",
    "artist_name",
    "audio_blob_cid",
    "audio_blob_media_type",
    "audio_blob_size",
    "audio_url",
    "collection",
    "commit_cid",
    "commit_rev",
    "deleted",
    "description",
    "duration_seconds",
    "featured_dids",
    "file_type",
    "image_url",
    "indexed_at_us",
    "owner_did",
    "record_cid",
    "record_created_at",
    "record_uri",
    "rkey",
    "self_labels",
    "support_gate_type",
    "title",
}
EXPECTED_PROFILE_COLUMNS = {
    "avatar",
    "bio",
    "collection",
    "commit_cid",
    "commit_rev",
    "deleted",
    "indexed_at_us",
    "owner_did",
    "record_cid",
    "record_created_at",
    "record_updated_at",
    "record_uri",
    "rkey",
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


def table_columns(database_url: str, table_name: str) -> set[str]:
    """Return the exact columns created for one projection table."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'plyr_index' "
                    "AND table_name = :table_name"
                ),
                {"table_name": table_name},
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
        columns = table_columns(database_url, "repo_heads")
        if columns != EXPECTED_HEAD_COLUMNS:
            raise AssertionError(f"unexpected repo_heads columns: {sorted(columns)!r}")
        cursor_columns = table_columns(database_url, "relay_cursors")
        if cursor_columns != EXPECTED_CURSOR_COLUMNS:
            raise AssertionError(
                f"unexpected relay_cursors columns: {sorted(cursor_columns)!r}"
            )
        track_columns = table_columns(database_url, "track_records")
        if track_columns != EXPECTED_TRACK_COLUMNS:
            raise AssertionError(
                f"unexpected track_records columns: {sorted(track_columns)!r}"
            )
        profile_columns = table_columns(database_url, "profile_records")
        if profile_columns != EXPECTED_PROFILE_COLUMNS:
            raise AssertionError(
                f"unexpected profile_records columns: {sorted(profile_columns)!r}"
            )
        availability_columns = table_columns(database_url, "account_availability")
        if availability_columns != EXPECTED_AVAILABILITY_COLUMNS:
            raise AssertionError(
                "unexpected account_availability columns: "
                f"{sorted(availability_columns)!r}"
            )
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
