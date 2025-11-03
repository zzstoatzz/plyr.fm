"""database models base class."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """base class for all models."""
