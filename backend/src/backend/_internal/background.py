"""background task infrastructure using pydocket.

provides a docket instance for scheduling background tasks and a worker
that runs alongside the FastAPI server. requires DOCKET_URL to be set
to a Redis URL.

usage:
    from backend._internal.background import get_docket

    docket = get_docket()
    await docket.add(my_task_function)(arg1, arg2)
"""

import asyncio
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
        RuntimeError: if docket is not initialized
    """
    if _docket is None:
        raise RuntimeError("docket not initialized - is the server running?")
    return _docket


@asynccontextmanager
async def background_worker_lifespan() -> AsyncGenerator[Docket, None]:
    """lifespan context manager for docket and its worker.

    initializes the docket connection and starts an in-process
    worker that processes background tasks.

    yields:
        Docket: the initialized docket instance
    """
    global _docket

    logger.info(
        "initializing docket",
        extra={"docket_name": settings.docket.name, "url": settings.docket.url},
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
            # cancel the worker task and wait for it to finish
            if worker_task:
                worker_task.cancel()
                try:
                    await worker_task
                except asyncio.CancelledError:
                    logger.debug("docket worker task cancelled")
            # clear global after worker is fully stopped
            _docket = None
            logger.info("docket worker stopped")


def _register_tasks(docket: Docket) -> None:
    """register all background task functions with the docket.

    tasks must be registered before they can be executed by workers.
    new tasks should be added to background_tasks.background_tasks list.
    """
    docket.register_collection("backend._internal.background_tasks:background_tasks")

    logger.info("registered background tasks")
