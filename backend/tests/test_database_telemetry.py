from contextlib import nullcontext

import logfire
import pytest
from logfire.testing import CaptureLogfire
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from backend.config import settings
from backend.utilities.database import get_engine


@pytest.mark.parametrize("fails", [False, True])
async def test_database_work_keeps_operation_trace_without_per_query_spans(
    _engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    capfire: CaptureLogfire,
    fails: bool,
) -> None:
    monkeypatch.setattr(settings.observability, "enabled", True)
    engine = get_engine()
    expected = pytest.raises(DBAPIError) if fails else nullcontext()
    with expected, logfire.span("database operation"):
        async with engine.connect() as connection:
            for _ in range(20):
                result = await connection.execute(text("SELECT 1"))
                assert result.scalar() == 1
            if fails:
                await connection.execute(text("SELECT 1 / 0"))

    completed = capfire.exporter.exported_spans_as_dict()
    assert [span["name"] for span in completed] == ["database operation"]
    assert bool(completed[0].get("events")) == fails
