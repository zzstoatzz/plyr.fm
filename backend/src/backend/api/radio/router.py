"""Shared radio router. Route handlers register on it from sibling modules."""

from fastapi import APIRouter

router = APIRouter(prefix="/radio", tags=["radio"])
