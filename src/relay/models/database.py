"""database setup and session management."""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from relay.config import settings

# use postgres from settings (neon or local)
engine = create_engine(settings.database_url)

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
