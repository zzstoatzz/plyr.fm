"""tests for queue service LISTEN/NOTIFY functionality."""

import asyncio
import contextlib
import json
import logging
from collections import Counter
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


async def test_heartbeat_detects_zombie_connection():
    """test that heartbeat proactively detects dead connections."""
    # create service with short timeout for testing
    queue_service = QueueService(heartbeat_interval=0.1, heartbeat_timeout=0.1)

    # create a mock connection that times out on execute
    mock_conn = mock.AsyncMock(spec=asyncpg.Connection)
    mock_conn.is_closed.return_value = False

    async def timeout_execute(*args, **kwargs):
        await asyncio.sleep(10)  # longer than heartbeat timeout

    mock_conn.execute = timeout_execute
    queue_service.conn = mock_conn

    # start heartbeat loop
    heartbeat_task = asyncio.create_task(queue_service._heartbeat_loop())

    # wait for timeout to trigger
    await asyncio.sleep(0.3)

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


@pytest.fixture
async def real_conn(test_database_url: str):
    """a real asyncpg connection, the way `_connect` builds one."""
    url = test_database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    try:
        yield conn
    finally:
        await conn.close()


async def test_concurrent_notifies_share_one_connection(
    queue_service: QueueService, real_conn: asyncpg.Connection, caplog
):
    """two overlapping queue updates NOTIFY on the same raw connection.

    regression for the production `InterfaceError: another operation is in
    progress` bursts from `_notify_change`: asyncpg connections are not safe
    for concurrent use, and every request handler shares `self.conn`.
    """
    queue_service.conn = real_conn

    with caplog.at_level("ERROR", logger="backend._internal.queue"):
        await asyncio.gather(
            *(queue_service._notify_change(f"did:plc:user{i}") for i in range(5))
        )

    assert not [r for r in caplog.records if "error sending queue change" in r.message]


async def test_notify_during_heartbeat_shares_one_connection(
    real_conn: asyncpg.Connection, caplog
):
    """queue updates that land while the heartbeat `SELECT 1` is in flight."""
    service = QueueService(heartbeat_interval=0.0, heartbeat_timeout=5.0)
    service.conn = real_conn
    heartbeat = asyncio.create_task(service._heartbeat_loop())

    try:
        with caplog.at_level("ERROR", logger="backend._internal.queue"):
            for _ in range(20):
                await asyncio.sleep(0)
                await service._notify_change("did:plc:user")
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat

    assert not [r for r in caplog.records if "error sending queue change" in r.message]


async def test_many_users_updating_under_heartbeat_pressure(
    test_database_url: str,
    db_session,
    real_conn: asyncpg.Connection,
    caplog,
):
    """hundreds of overlapping queue updates from many users, with the
    heartbeat hammering the shared connection the whole time, must all
    persist and all reach a listener on another connection."""
    users = 100
    updates_per_user = 5

    service = QueueService(heartbeat_interval=0.0, heartbeat_timeout=5.0)
    service.conn = real_conn
    heartbeat = asyncio.create_task(service._heartbeat_loop())

    received: list[str] = []
    listener = await asyncpg.connect(
        test_database_url.replace("postgresql+asyncpg://", "postgresql://")
    )

    def on_notify(conn, pid, channel, payload) -> None:
        received.append(json.loads(payload)["did"])

    await listener.add_listener("queue_changes", on_notify)

    dids = [f"did:plc:load{i}" for i in range(users)]
    try:
        for did in dids:
            assert await service.update_queue(did, {"track_ids": []})
        await asyncio.sleep(0.2)
        received.clear()
        with caplog.at_level("WARNING", logger="backend._internal.queue"):
            results = await asyncio.gather(
                *(
                    service.update_queue(did, {"track_ids": [], "current_index": n})
                    for did in dids
                    for n in range(updates_per_user)
                )
            )
        await asyncio.sleep(0.5)
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat
        await listener.close()

    assert not [r for r in caplog.records if r.levelno >= logging.WARNING], [
        r.message for r in caplog.records
    ]
    assert all(results)
    assert {r[1] for r in results if r} <= set(range(2, updates_per_user + 2))
    assert Counter(received) == dict.fromkeys(dids, updates_per_user)
    assert service.conn is real_conn and not real_conn.is_closed()
