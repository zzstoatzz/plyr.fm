"""background task infrastructure using pydocket.

provides a docket instance for scheduling background tasks and a worker
that runs alongside the FastAPI server. defaults to in-memory mode for
development; configure DOCKET_URL for Redis-backed durable execution.

usage:
    from backend._internal.background import docket

    # schedule a task
    await docket.add(my_task_function)(arg1, arg2)

    # tasks are registered in this module and run by the in-process worker
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from docket import Docket, Worker

from backend.config import settings

logger = logging.getLogger(__name__)

# global docket instance - initialized in lifespan
_docket: Docket | None = None


def get_docket() -> Docket:
    """get the global docket instance.

    raises:
        RuntimeError: if docket is not initialized (server not started)
    """
    if _docket is None:
        raise RuntimeError("docket not initialized - is the server running?")
    return _docket


@asynccontextmanager
async def background_worker_lifespan() -> AsyncGenerator[Docket, None]:
    """lifespan context manager for docket and its worker.

    initializes the docket connection and starts an in-process worker
    that processes background tasks. the worker runs as an asyncio task
    alongside the FastAPI server.

    yields:
        Docket: the initialized docket instance for scheduling tasks
    """
    global _docket

    logger.info(
        "initializing docket",
        extra={"name": settings.docket.name, "url": settings.docket.url},
    )

    async with Docket(
        name=settings.docket.name,
        url=settings.docket.url,
    ) as docket:
        _docket = docket

        # register all background task functions
        _register_tasks(docket)

        # start worker as background task
        worker_task: asyncio.Task[None] | None = None
        try:
            async with Worker(
                docket,
                concurrency=settings.docket.worker_concurrency,
            ) as worker:
                worker_task = asyncio.create_task(
                    worker.run_forever(),
                    name="docket-worker",
                )
                logger.info(
                    "docket worker started",
                    extra={"concurrency": settings.docket.worker_concurrency},
                )
                yield docket
        finally:
            if worker_task:
                worker_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await worker_task
            _docket = None
            logger.info("docket worker stopped")


def _register_tasks(docket: Docket) -> None:
    """register all background task functions with the docket.

    tasks must be registered before they can be executed by workers.
    add new task imports here as they're created.
    """
    # import task functions here to avoid circular imports
    from backend._internal.background_tasks import (
        process_upload,
        scan_copyright,
    )

    docket.register(process_upload)
    docket.register(scan_copyright)

    logger.info(
        "registered background tasks",
        extra={"tasks": ["process_upload", "scan_copyright"]},
    )
