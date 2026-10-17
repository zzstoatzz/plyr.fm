"""Tie consumer failure to its owning process instead of its heartbeat."""

import asyncio
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from docket import Worker

logger = logging.getLogger(__name__)
WORKER_CLOSE_SECONDS = 5


@asynccontextmanager
async def supervised_worker(worker: Worker) -> AsyncIterator[None]:
    await worker.__aenter__()
    stopping = False

    async def consume() -> None:
        await worker.run_forever()
        if not stopping:
            raise RuntimeError("docket consumer exited unexpectedly")

    try:
        async with asyncio.TaskGroup() as tasks:
            consumer = tasks.create_task(consume(), name="docket-worker")
            try:
                yield
            finally:
                stopping = True
                consumer.cancel()
    finally:
        try:
            async with asyncio.timeout(WORKER_CLOSE_SECONDS):
                await worker.__aexit__(*sys.exc_info())
        except TimeoutError:
            logger.error("docket worker shutdown timed out")
            raise
