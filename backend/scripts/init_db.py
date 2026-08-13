"""create the full schema on an empty database and stamp it at alembic head.

the migration chain starts from a snapshot that predates alembic adoption, so
`alembic upgrade head` cannot bootstrap an empty database. run this once for a
fresh local database, then use `alembic upgrade head` for later migrations.
"""

import asyncio
import sys
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from sqlalchemy.engine import Connection

from alembic import command
from backend.models import Base
from backend.utilities.database import get_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_CONFIG = BACKEND_DIR / "alembic.ini"
BASE_SCHEMA_REVISION = "4aaed6c819f1"
MIGRATION_OWNED_SCHEMAS = frozenset({"plyr_auth", "plyr_index"})


def create_base_schema(connection: Connection) -> None:
    """Create ORM-owned tables; later migrations own successor schemas."""
    tables = [
        table
        for table in Base.metadata.sorted_tables
        if table.schema not in MIGRATION_OWNED_SCHEMAS
    ]
    Base.metadata.create_all(connection, tables=tables)


async def create_schema() -> bool:
    engine = get_engine()
    try:
        async with engine.begin() as conn:
            already_migrated = await conn.run_sync(
                lambda sync_conn: sa.inspect(sync_conn).has_table("alembic_version")
            )
            if already_migrated:
                return False
            await conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.run_sync(create_base_schema)
            return True
    finally:
        await engine.dispose()


def main() -> None:
    if not asyncio.run(create_schema()):
        print(
            "database already has an alembic_version table — "
            "use `uv run alembic upgrade head` instead",
            file=sys.stderr,
        )
        raise SystemExit(1)

    config = Config(ALEMBIC_CONFIG)
    command.stamp(config, BASE_SCHEMA_REVISION)
    command.upgrade(config, "head")
    print("schema created and stamped at alembic head")


if __name__ == "__main__":
    main()
