"""create the full schema on an empty database and stamp it at alembic head.

the migration chain starts from a snapshot that predates alembic adoption, so
`alembic upgrade head` cannot bootstrap an empty database. run this once for a
fresh local database, then use `alembic upgrade head` for later migrations.
"""

import asyncio
import sys

import sqlalchemy as sa

from alembic import command
from alembic.config import Config
from backend.models import Base
from backend.utilities.database import get_engine


async def create_schema() -> bool:
    engine = get_engine()
    try:
        async with engine.begin() as conn:
            already_migrated = await conn.run_sync(
                lambda sync_conn: sa.inspect(sync_conn).has_table("alembic_version")
            )
            if already_migrated:
                return False
            await conn.run_sync(Base.metadata.create_all)
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

    command.stamp(Config("alembic.ini"), "head")
    print("schema created and stamped at alembic head")


if __name__ == "__main__":
    main()
