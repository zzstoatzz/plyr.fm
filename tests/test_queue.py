"""tests for queue service LISTEN/NOTIFY functionality."""

import asyncio
import contextlib
from unittest import mock

import asyncpg
import pytest

from backend._internal.queue import QueueService


@pytest.fixture
def queue_service():
    """create a queue service instance for testing."""
    return QueueService()


async def test_notify_with_timeout_prevents_hang(queue_service: QueueService):
    """test that NOTIFY operations timeout instead of hanging forever."""
    # create a mock connection that hangs on execute
    mock_conn = mock.AsyncMock(spec=asyncpg.Connection)
    mock_conn.is_closed.return_value = False

    async def slow_execute(*args, **kwargs):
        # simulate zombie connection that never responds
        await asyncio.sleep(999)

    mock_conn.execute = slow_execute

    queue_service.conn = mock_conn

    # NOTIFY should timeout in 1 second, not hang for 999 seconds
    start = asyncio.get_event_loop().time()
    await queue_service._notify_change("did:plc:test")
    elapsed = asyncio.get_event_loop().time() - start

    # should complete quickly due to timeout
    assert elapsed < 2.0, f"notify took {elapsed}s, should timeout in ~1s"

    # connection should be marked as dead
    assert queue_service.conn is None


async def test_heartbeat_detects_zombie_connection(queue_service: QueueService):
    """test that heartbeat proactively detects dead connections."""
    # create a mock connection that times out on execute
    mock_conn = mock.AsyncMock(spec=asyncpg.Connection)
    mock_conn.is_closed.return_value = False

    async def timeout_execute(*args, **kwargs):
        await asyncio.sleep(10)  # longer than heartbeat timeout

    mock_conn.execute = timeout_execute
    queue_service.conn = mock_conn

    # start heartbeat loop
    heartbeat_task = asyncio.create_task(queue_service._heartbeat_loop())

    # wait for one heartbeat cycle
    await asyncio.sleep(0.5)

    # cancel the heartbeat task
    heartbeat_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await heartbeat_task

    # connection should be marked as dead after heartbeat timeout
    assert queue_service.conn is None


async def test_notify_handles_closed_connection_gracefully(queue_service: QueueService):
    """test that NOTIFY handles already-closed connections gracefully."""
    mock_conn = mock.AsyncMock(spec=asyncpg.Connection)
    mock_conn.is_closed.return_value = True

    queue_service.conn = mock_conn

    # should return early without attempting NOTIFY
    await queue_service._notify_change("did:plc:test")

    # execute should not have been called
    mock_conn.execute.assert_not_called()


async def test_notify_handles_none_connection_gracefully(queue_service: QueueService):
    """test that NOTIFY handles None connection gracefully."""
    queue_service.conn = None

    # should not raise
    await queue_service._notify_change("did:plc:test")
