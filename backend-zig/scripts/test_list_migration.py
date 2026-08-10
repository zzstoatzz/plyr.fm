"""Exercise the Zig-owned projection migrations against zig_test only."""

from __future__ import annotations

import os
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command

PRIOR_REVISION = "4aaed6c819f1"
HEAD_REVISION = "e82b3d0f5a94"
CANARY_ROLE = "plyr_zig_canary"
COMPATIBILITY_TABLES = {"tracks", "artists", "albums", "user_preferences"}
EXPECTED_TABLES = {
    "account_availability",
    "account_status_checks",
    "list_members",
    "list_records",
    "like_records",
    "profile_records",
    "record_rejections",
    "relay_cursors",
    "repo_heads",
    "track_records",
    "track_delivery_origins",
    "track_metrics",
    "track_policies",
}
EXPECTED_AUTH_TABLES = {"exchange_tokens", "oauth_requests", "sessions"}
EXPECTED_AUTH_TABLE_PRIVILEGES = {
    "oauth_requests": {"SELECT", "INSERT", "DELETE"},
    "sessions": {"SELECT", "INSERT"},
    "exchange_tokens": {"SELECT", "INSERT", "DELETE"},
}
EXPECTED_AUTH_COLUMNS = {
    "oauth_requests": {"state_digest", "sealed_payload", "created_at", "expires_at"},
    "sessions": {
        "session_digest",
        "group_id",
        "did",
        "handle",
        "scope",
        "sealed_credentials",
        "created_at",
        "expires_at",
        "revoked_at",
    },
    "exchange_tokens": {
        "token_digest",
        "session_digest",
        "sealed_session_token",
        "created_at",
        "expires_at",
    },
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
EXPECTED_STATUS_CHECK_COLUMNS = {
    "attempt_count",
    "consecutive_failures",
    "hinted_at_us",
    "last_attempt_at_us",
    "last_completed_at_us",
    "last_outcome",
    "last_response_authoritative",
    "last_success_at_us",
    "lease_until_us",
    "next_attempt_at_us",
    "repo_did",
}
EXPECTED_REJECTION_COLUMNS = {
    "collection",
    "commit_cid",
    "commit_rev",
    "detail",
    "indexed_at_us",
    "owner_did",
    "reason",
    "record_cid",
    "record_uri",
    "rkey",
}
EXPECTED_DELIVERY_COLUMNS = {
    "artifact_cid",
    "media_type",
    "observed_at_us",
    "origin_url",
    "record_cid",
    "record_uri",
    "service",
    "verification",
}
EXPECTED_POLICY_COLUMNS = {
    "access_observed_at_us",
    "access_write_source",
    "moderation_decision",
    "moderation_observed_at_us",
    "moderation_write_source",
    "operator_labels",
    "record_uri",
    "space_uri",
    "visibility",
}
EXPECTED_METRIC_COLUMNS = {
    "observed_at_us",
    "play_count",
    "record_uri",
    "write_source",
}
EXPECTED_SEARCH_INDEXES = {
    "ix_like_records_owner_live",
    "ix_like_records_subject_live",
    "ix_plyr_index_list_records_name_trgm",
    "ix_plyr_index_track_records_title_trgm",
}
EXPECTED_LIKE_COLUMNS = {
    "collection",
    "commit_cid",
    "commit_rev",
    "deleted",
    "indexed_at_us",
    "owner_did",
    "record_cid",
    "record_created_at",
    "record_uri",
    "rkey",
    "subject_cid",
    "subject_uri",
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
    """Refuse destructive work anywhere except the disposable zig_test DB."""
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            database_name = connection.scalar(text("SELECT current_database()"))
            if database_name != "zig_test":
                raise RuntimeError(f"unsafe migration test database: {database_name!r}")
            connection.execute(text("DROP SCHEMA IF EXISTS plyr_index CASCADE"))
            connection.execute(text("DROP SCHEMA IF EXISTS plyr_auth CASCADE"))
            role_exists = connection.scalar(
                text("SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = :role)"),
                {"role": CANARY_ROLE},
            )
            if role_exists:
                connection.execute(text(f"DROP OWNED BY {CANARY_ROLE}"))
                connection.execute(text(f"DROP ROLE {CANARY_ROLE}"))
            connection.execute(text(f"CREATE ROLE {CANARY_ROLE} NOLOGIN"))
            connection.execute(
                text("DROP TABLE IF EXISTS public.share_link_events CASCADE")
            )
            connection.execute(text("DROP TABLE IF EXISTS public.share_links CASCADE"))
            connection.execute(text("DROP TABLE IF EXISTS public.tracks CASCADE"))
            connection.execute(
                text(
                    "CREATE TABLE public.tracks ("
                    "id serial PRIMARY KEY, atproto_record_uri text, "
                    "visibility text NOT NULL, space_uri text, "
                    "operator_labels jsonb NOT NULL DEFAULT '[]', "
                    "moderation_override text, play_count integer NOT NULL DEFAULT 0)"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE public.share_links ("
                    "id serial PRIMARY KEY, code text UNIQUE NOT NULL, "
                    "track_id integer NOT NULL REFERENCES public.tracks(id), "
                    "creator_did text NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE public.share_link_events ("
                    "id serial PRIMARY KEY, "
                    "share_link_id integer NOT NULL REFERENCES public.share_links(id), "
                    "visitor_did text, event_type text NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO public.tracks ("
                    "atproto_record_uri, visibility, space_uri, operator_labels, "
                    "moderation_override, play_count) VALUES "
                    "('at://did:plc:test/fm.plyr.track/public', 'public', NULL, "
                    "'[\"sexual\"]', NULL, 7), "
                    "('at://did:plc:test/fm.plyr.track/private', 'private', "
                    "'at://did:plc:test/fm.plyr.space/private/test', '[]', NULL, 11), "
                    "('at://did:plc:test/fm.plyr.track/unrelated', 'public', NULL, "
                    "'[\"unrelated-label\"]', 'unsupported', 0), "
                    "(NULL, 'public', NULL, '[]', NULL, 99)"
                )
            )
            for table_name in COMPATIBILITY_TABLES - {"tracks"}:
                connection.execute(
                    text(f"DROP TABLE IF EXISTS public.{table_name} CASCADE")
                )
                connection.execute(
                    text(f"CREATE TABLE public.{table_name} (id integer)")
                )
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


def schema_tables(database_url: str, schema: str) -> set[str]:
    """Return the tables in one application-owned schema."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = :schema"
                ),
                {"schema": schema},
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


def table_columns(
    database_url: str, table_name: str, schema: str = "plyr_index"
) -> set[str]:
    """Return the exact columns created for one application table."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = :schema "
                    "AND table_name = :table_name"
                ),
                {"schema": schema, "table_name": table_name},
            )
            return {str(row[0]) for row in rows}
    finally:
        engine.dispose()


def projection_indexes(database_url: str) -> set[str]:
    """Return named indexes in the rebuildable projection schema."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("SELECT indexname FROM pg_indexes WHERE schemaname = 'plyr_index'")
            )
            return {str(row[0]) for row in rows}
    finally:
        engine.dispose()


def role_has_privilege(database_url: str, object_name: str, privilege: str) -> bool:
    """Return one effective privilege for the disposable canary role."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            function = (
                "has_schema_privilege"
                if object_name in {"plyr_index", "plyr_auth"}
                else "has_table_privilege"
            )
            return bool(
                connection.scalar(
                    text(f"SELECT {function}(:role, :object, :privilege)"),
                    {
                        "role": CANARY_ROLE,
                        "object": object_name,
                        "privilege": privilege,
                    },
                )
            )
    finally:
        engine.dispose()


def role_has_column_privilege(
    database_url: str, object_name: str, column_name: str, privilege: str
) -> bool:
    """Return one effective column privilege for the disposable canary role."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            return bool(
                connection.scalar(
                    text(
                        "SELECT has_column_privilege("
                        ":role, :object, :column, :privilege)"
                    ),
                    {
                        "role": CANARY_ROLE,
                        "object": object_name,
                        "column": column_name,
                        "privilege": privilege,
                    },
                )
            )
    finally:
        engine.dispose()


def role_has_sequence_privilege(
    database_url: str, object_name: str, privilege: str
) -> bool:
    """Return one effective sequence privilege for the disposable canary role."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            return bool(
                connection.scalar(
                    text("SELECT has_sequence_privilege(:role, :object, :privilege)"),
                    {
                        "role": CANARY_ROLE,
                        "object": object_name,
                        "privilege": privilege,
                    },
                )
            )
    finally:
        engine.dispose()


def assert_canary_least_privilege(database_url: str) -> None:
    """Prove the API role writes only play metrics and isolated auth state."""
    if not role_has_privilege(database_url, "plyr_index", "USAGE"):
        raise AssertionError("canary role cannot use the projection schema")
    for table_name in EXPECTED_TABLES:
        object_name = f"plyr_index.{table_name}"
        if not role_has_privilege(database_url, object_name, "SELECT"):
            raise AssertionError(f"canary role cannot read {object_name}")
        expected_writes = (
            {"INSERT", "UPDATE"} if table_name == "track_metrics" else set()
        )
        for privilege in ("INSERT", "UPDATE", "DELETE"):
            if privilege in expected_writes:
                if not role_has_privilege(database_url, object_name, privilege):
                    raise AssertionError(
                        f"canary role cannot {privilege} {object_name}"
                    )
                continue
            if role_has_privilege(database_url, object_name, privilege):
                raise AssertionError(f"canary role can {privilege} {object_name}")
    if not role_has_privilege(database_url, "plyr_auth", "USAGE"):
        raise AssertionError("canary role cannot use the auth schema")
    for table_name in EXPECTED_AUTH_TABLES:
        object_name = f"plyr_auth.{table_name}"
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            actual = role_has_privilege(database_url, object_name, privilege)
            expected = privilege in EXPECTED_AUTH_TABLE_PRIVILEGES[table_name]
            if actual != expected:
                outcome = "cannot" if expected else "can"
                raise AssertionError(f"canary {outcome} {privilege} {object_name}")
    session_columns = EXPECTED_AUTH_COLUMNS["sessions"]
    for column_name in session_columns:
        actual = role_has_column_privilege(
            database_url,
            "plyr_auth.sessions",
            column_name,
            "UPDATE",
        )
        expected = column_name == "revoked_at"
        if actual != expected:
            outcome = "cannot" if expected else "can"
            raise AssertionError(
                f"canary {outcome} UPDATE plyr_auth.sessions.{column_name}"
            )
    for table_name in COMPATIBILITY_TABLES:
        object_name = f"public.{table_name}"
        if not role_has_privilege(database_url, object_name, "SELECT"):
            raise AssertionError(f"canary role cannot read {object_name}")
        for privilege in ("INSERT", "UPDATE", "DELETE"):
            if role_has_privilege(database_url, object_name, privilege):
                raise AssertionError(f"canary role can {privilege} {object_name}")

    if not role_has_column_privilege(
        database_url, "public.tracks", "play_count", "UPDATE"
    ):
        raise AssertionError("canary cannot mirror the legacy play count")
    for column_name in ("atproto_record_uri", "visibility", "space_uri"):
        if role_has_column_privilege(
            database_url, "public.tracks", column_name, "UPDATE"
        ):
            raise AssertionError(f"canary can update tracks.{column_name}")
    if not role_has_privilege(database_url, "public.share_links", "SELECT"):
        raise AssertionError("canary cannot resolve share attribution")
    if not role_has_privilege(database_url, "public.share_link_events", "INSERT"):
        raise AssertionError("canary cannot record share attribution")
    for privilege in ("SELECT", "UPDATE", "DELETE"):
        if role_has_privilege(database_url, "public.share_link_events", privilege):
            raise AssertionError(f"canary can {privilege} public.share_link_events")
    sequence_name = "public.share_link_events_id_seq"
    if not role_has_sequence_privilege(database_url, sequence_name, "USAGE"):
        raise AssertionError("canary cannot allocate share attribution ids")
    for privilege in ("SELECT", "UPDATE"):
        if role_has_sequence_privilege(database_url, sequence_name, privilege):
            raise AssertionError(f"canary can {privilege} {sequence_name}")

    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE plyr_index.future_projection (id int)")
            )
        if not role_has_privilege(
            database_url, "plyr_index.future_projection", "SELECT"
        ):
            raise AssertionError("canary default privileges omit future tables")
        for privilege in ("INSERT", "UPDATE", "DELETE"):
            if role_has_privilege(
                database_url,
                "plyr_index.future_projection",
                privilege,
            ):
                raise AssertionError(
                    f"canary default privileges permit future-table {privilege}"
                )
    finally:
        with engine.begin() as connection:
            connection.execute(
                text("DROP TABLE IF EXISTS plyr_index.future_projection")
            )
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
        auth_tables = schema_tables(database_url, "plyr_auth")
        if auth_tables != EXPECTED_AUTH_TABLES:
            raise AssertionError(
                f"unexpected plyr_auth tables: {sorted(auth_tables)!r}"
            )
        for table_name, expected_columns in EXPECTED_AUTH_COLUMNS.items():
            columns = table_columns(database_url, table_name, "plyr_auth")
            if columns != expected_columns:
                raise AssertionError(
                    f"unexpected plyr_auth.{table_name} columns: {sorted(columns)!r}"
                )
        indexes = projection_indexes(database_url)
        if not indexes >= EXPECTED_SEARCH_INDEXES:
            raise AssertionError(
                f"missing projection search indexes: {sorted(indexes)!r}"
            )
        assert_canary_least_privilege(database_url)
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
        like_columns = table_columns(database_url, "like_records")
        if like_columns != EXPECTED_LIKE_COLUMNS:
            raise AssertionError(
                f"unexpected like_records columns: {sorted(like_columns)!r}"
            )
        availability_columns = table_columns(database_url, "account_availability")
        if availability_columns != EXPECTED_AVAILABILITY_COLUMNS:
            raise AssertionError(
                "unexpected account_availability columns: "
                f"{sorted(availability_columns)!r}"
            )
        status_check_columns = table_columns(database_url, "account_status_checks")
        if status_check_columns != EXPECTED_STATUS_CHECK_COLUMNS:
            raise AssertionError(
                "unexpected account_status_checks columns: "
                f"{sorted(status_check_columns)!r}"
            )
        rejection_columns = table_columns(database_url, "record_rejections")
        if rejection_columns != EXPECTED_REJECTION_COLUMNS:
            raise AssertionError(
                f"unexpected record_rejections columns: {sorted(rejection_columns)!r}"
            )
        delivery_columns = table_columns(database_url, "track_delivery_origins")
        if delivery_columns != EXPECTED_DELIVERY_COLUMNS:
            raise AssertionError(
                "unexpected track_delivery_origins columns: "
                f"{sorted(delivery_columns)!r}"
            )
        policy_columns = table_columns(database_url, "track_policies")
        if policy_columns != EXPECTED_POLICY_COLUMNS:
            raise AssertionError(
                f"unexpected track_policies columns: {sorted(policy_columns)!r}"
            )
        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                imported = connection.execute(
                    text(
                        "SELECT record_uri, visibility, space_uri, "
                        "access_write_source, operator_labels, "
                        "moderation_decision, moderation_write_source "
                        "FROM plyr_index.track_policies ORDER BY record_uri"
                    )
                ).all()
            if len(imported) != 3 or any(
                row.access_write_source != "legacy_import" for row in imported
            ):
                raise AssertionError(f"unexpected policy backfill: {imported!r}")
            moderated = [row for row in imported if row.operator_labels]
            if (
                len(moderated) != 1
                or moderated[0].operator_labels != ["sexual"]
                or moderated[0].moderation_decision is not None
                or moderated[0].moderation_write_source != "legacy_import"
            ):
                raise AssertionError(f"unexpected policy backfill: {moderated!r}")
        finally:
            engine.dispose()
        metric_columns = table_columns(database_url, "track_metrics")
        if metric_columns != EXPECTED_METRIC_COLUMNS:
            raise AssertionError(
                f"unexpected track_metrics columns: {sorted(metric_columns)!r}"
            )
        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                metrics = connection.execute(
                    text(
                        "SELECT record_uri, play_count, write_source "
                        "FROM plyr_index.track_metrics ORDER BY record_uri"
                    )
                ).all()
            if [row.play_count for row in metrics] != [11, 7, 0] or any(
                row.write_source != "legacy_import" for row in metrics
            ):
                raise AssertionError(f"unexpected metrics backfill: {metrics!r}")
        finally:
            engine.dispose()
    finally:
        if upgraded:
            command.downgrade(config, PRIOR_REVISION)
        else:
            assert_test_database_and_drop_schema(database_url)

    if projection_schema_exists(database_url):
        raise AssertionError("migration downgrade left plyr_index schema")
    if remaining := projected_tables(database_url):
        raise AssertionError(f"migration downgrade left tables: {sorted(remaining)!r}")
    if remaining := schema_tables(database_url, "plyr_auth"):
        raise AssertionError(
            f"migration downgrade left auth tables: {sorted(remaining)!r}"
        )
    for table_name in COMPATIBILITY_TABLES:
        if role_has_privilege(database_url, f"public.{table_name}", "SELECT"):
            raise AssertionError(f"downgrade left compatibility read: {table_name}")
    for object_name, privilege in (
        ("public.tracks", "UPDATE"),
        ("public.share_links", "SELECT"),
        ("public.share_link_events", "INSERT"),
    ):
        if role_has_privilege(database_url, object_name, privilege):
            raise AssertionError(
                f"downgrade left {privilege} privilege on {object_name}"
            )
    for privilege in ("USAGE", "SELECT", "UPDATE"):
        if role_has_sequence_privilege(
            database_url, "public.share_link_events_id_seq", privilege
        ):
            raise AssertionError("downgrade left share attribution sequence privilege")

    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE SCHEMA plyr_index"))
            connection.execute(
                text("CREATE TABLE plyr_index.future_projection (id int)")
            )
        if role_has_privilege(database_url, "plyr_index", "USAGE"):
            raise AssertionError("downgrade left canary schema usage")
        if role_has_privilege(database_url, "plyr_index.future_projection", "SELECT"):
            raise AssertionError("downgrade left canary default table reads")
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA plyr_index CASCADE"))
            connection.execute(text(f"DROP OWNED BY {CANARY_ROLE}"))
            connection.execute(text(f"DROP ROLE {CANARY_ROLE}"))
        engine.dispose()

    # Developer databases do not need the deployment-only role. The same
    # migration chain must remain usable there without granting to or creating
    # an ambient principal.
    command.upgrade(config, HEAD_REVISION)
    try:
        if not projection_schema_exists(database_url):
            raise AssertionError("role-absent migration did not create the projection")
    finally:
        command.downgrade(config, PRIOR_REVISION)


if __name__ == "__main__":
    main()
