"""Regression coverage for the fresh-database bootstrap entry point."""

from pathlib import Path
from unittest.mock import Mock

import sqlalchemy as sa

from scripts import init_db


def test_alembic_config_is_independent_of_working_directory(
    monkeypatch,
    tmp_path: Path,
) -> None:
    """The root-level invocation must find the backend Alembic project."""
    monkeypatch.chdir(tmp_path)

    config = init_db.Config(init_db.ALEMBIC_CONFIG)
    script_location = config.get_main_option("script_location")

    assert Path(config.config_file_name or "") == init_db.ALEMBIC_CONFIG
    assert script_location is not None
    assert Path(script_location).is_absolute()


def test_base_schema_excludes_migration_owned_tables() -> None:
    connection = Mock()
    metadata = Mock()
    public_table = sa.Table("public_table", sa.MetaData(), sa.Column("id", sa.Integer))
    index_table = sa.Table(
        "index_table",
        sa.MetaData(),
        sa.Column("id", sa.Integer),
        schema="plyr_index",
    )
    auth_table = sa.Table(
        "auth_table",
        sa.MetaData(),
        sa.Column("id", sa.Integer),
        schema="plyr_auth",
    )
    metadata.sorted_tables = [public_table, index_table, auth_table]
    metadata.create_all = Mock()
    original_metadata = init_db.Base.metadata
    init_db.Base.metadata = metadata
    try:
        init_db.create_base_schema(connection)
    finally:
        init_db.Base.metadata = original_metadata

    metadata.create_all.assert_called_once_with(connection, tables=[public_table])


def test_main_stamps_base_then_runs_successor_migrations(monkeypatch) -> None:
    async def created() -> bool:
        return True

    stamp = Mock()
    upgrade = Mock()
    monkeypatch.setattr(init_db, "create_schema", created)
    monkeypatch.setattr(init_db.command, "stamp", stamp)
    monkeypatch.setattr(init_db.command, "upgrade", upgrade)

    init_db.main()

    config = stamp.call_args.args[0]
    stamp.assert_called_once_with(config, init_db.BASE_SCHEMA_REVISION)
    upgrade.assert_called_once_with(config, "head")
