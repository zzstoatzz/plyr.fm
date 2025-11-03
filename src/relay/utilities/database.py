"""database engine and session management utilities."""

import uuid
from asyncio import get_running_loop
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from relay.config import settings

# per-event-loop engine cache (following nebula pattern)
ENGINES: dict[tuple[Any, ...], AsyncEngine] = {}


def get_engine() -> AsyncEngine:
    """retrieve an async sqlalchemy engine.

    a new engine is created for each event loop and cached, so that engines
    are not shared across loops.

    returns:
        AsyncEngine: a sqlalchemy engine
    """
    loop = get_running_loop()
    cache_key = (loop, settings.database_url)

    if cache_key not in ENGINES:
        # asyncpg-specific connection args for statement caching issues
        # only applies when using postgresql+asyncpg:// URL scheme
        kwargs: dict[str, Any] = {}
        if "asyncpg" in settings.database_url:
            kwargs["connect_args"] = {
                # see https://github.com/MagicStack/asyncpg/issues/1058#issuecomment-1913635739
                "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
                "statement_cache_size": 0,
                "prepared_statement_cache_size": 0,
            }

        engine = create_async_engine(
            settings.database_url,
            echo=settings.debug,
            pool_pre_ping=True,  # verify connections before use
            pool_recycle=3600,  # recycle connections after 1 hour
            pool_use_lifo=True,  # reuse recent connections
            pool_size=5,
            max_overflow=0,
            **kwargs,
        )

        # instrument sqlalchemy with logfire if enabled
        if settings.logfire_enabled:
            import logfire

            logfire.instrument_sqlalchemy(engine.sync_engine)

        ENGINES[cache_key] = engine

    return ENGINES[cache_key]


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """get async database session."""
    engine = get_engine()
    async_session_maker = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with async_session_maker() as session:
        yield session


async def init_db():
    """initialize database tables."""
    from relay.models.database import Base

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
