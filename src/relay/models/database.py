"""database setup and session management."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from relay.config import settings

# use postgres from settings (neon or local)
# configure connection pool for neon serverless postgres, following nebula's pattern
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,  # verify connections before use (fixes SSL connection drops)
    pool_recycle=3600,  # recycle connections after 1 hour (neon serverless behavior)
    pool_use_lifo=True,  # reuse recent connections (helps with serverless idle timeouts)
    pool_size=5,  # max persistent connections
    max_overflow=0,  # no overflow connections
)

# instrument sqlalchemy with logfire if enabled
if settings.logfire_enabled:
    import logfire

    logfire.instrument_sqlalchemy(engine)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """base class for all models."""


def get_db():
    """get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """initialize database tables."""
    Base.metadata.create_all(bind=engine)
