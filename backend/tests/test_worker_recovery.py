"""A real Redis network stall must not leave a heartbeating zombie process."""

import asyncio
import contextlib
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import pytest
from docket import Docket
from redis.asyncio import Redis

from backend.config import settings
from tests.helpers.worker_process import probe


async def wait_for_key(redis: Redis, key: str) -> None:
    async with asyncio.timeout(15):
        while not await redis.exists(key):
            await asyncio.sleep(0.05)


@contextlib.asynccontextmanager
async def redis_proxy() -> AsyncIterator[tuple[str, asyncio.Event]]:
    source = urlparse(settings.docket.url)
    gate = asyncio.Event()
    gate.set()
    connections: set[asyncio.Task[None]] = set()

    async def connection(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        task = asyncio.current_task()
        assert task is not None
        connections.add(task)
        upstream_reader, upstream_writer = await asyncio.open_connection(
            source.hostname, source.port or 6379
        )

        async def copy(
            input: asyncio.StreamReader, output: asyncio.StreamWriter
        ) -> None:
            while chunk := await input.read(65536):
                await gate.wait()
                output.write(chunk)
                await output.drain()

        try:
            async with asyncio.TaskGroup() as tasks:
                forward = tasks.create_task(copy(reader, upstream_writer))
                reverse = tasks.create_task(copy(upstream_reader, writer))
                await asyncio.wait(
                    (forward, reverse), return_when=asyncio.FIRST_COMPLETED
                )
                forward.cancel()
                reverse.cancel()
        except (ConnectionError, ExceptionGroup):
            pass
        finally:
            upstream_writer.close()
            writer.close()
            connections.discard(task)

    server = await asyncio.start_server(connection, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    url = urlunparse(
        source._replace(
            netloc=f"127.0.0.1:{port}",
            query="socket_timeout=2&socket_connect_timeout=2",
        )
    )
    try:
        async with server:
            yield url, gate
    finally:
        for task in list(connections):
            task.cancel()
        await asyncio.gather(*connections, return_exceptions=True)


@pytest.mark.timeout(60)
@pytest.mark.parametrize("active", [False, True])
async def test_consumer_failure_exits_and_replacement_drains_work(active: bool) -> None:
    namespace = f"recovery-{uuid4()}"
    processes: list[asyncio.subprocess.Process] = []
    async with (
        redis_proxy() as (url, gate),
        Docket(name=namespace, url=settings.docket.url) as docket,
        Redis.from_url(settings.docket.url) as redis,
    ):
        docket.register(probe)

        async def start() -> asyncio.subprocess.Process:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(Path(__file__).parent / "helpers/worker_process.py"),
                namespace,
                url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            processes.append(process)
            assert process.stdout is not None
            assert await asyncio.wait_for(process.stdout.readline(), 15) == b"ready\n"
            return process

        try:
            process = await start()
            initial = f"{namespace}:first"
            await docket.add(probe)(settings.docket.url, initial, 5 if active else 0)
            await wait_for_key(redis, f"{initial}:started" if active else initial)
            if not active:
                await asyncio.sleep(0.5)
            gate.clear()
            queued = f"{namespace}:after-interruption"
            await docket.add(probe)(settings.docket.url, queued)
            async with asyncio.timeout(30):
                assert await process.wait() != 0
            assert not await redis.exists(queued)
            gate.set()
            replacement = await start()
            await wait_for_key(redis, queued)
            fresh = f"{namespace}:fresh"
            await docket.add(probe)(settings.docket.url, fresh)
            await wait_for_key(redis, fresh)
            replacement.terminate()
            assert await asyncio.wait_for(replacement.wait(), 10) == 0
        finally:
            gate.set()
            for process in processes:
                if process.returncode is None:
                    process.kill()
                await process.wait()
