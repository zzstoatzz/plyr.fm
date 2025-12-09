"""background task infrastructure using pydocket.

provides a docket instance for scheduling background tasks and a worker
that runs alongside the FastAPI server. requires DOCKET_URL to be set
to a Redis URL for durable execution across multiple machines.

usage:
    from backend._internal.background import get_docket, is_docket_enabled

    if is_docket_enabled():
        docket = get_docket()
        await docket.add(my_task_function)(arg1, arg2)
    else:
        # fallback to direct execution or FastAPI BackgroundTasks
        await my_task_function(arg1, arg2)
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from docket import Docket, Worker

from backend.config import settings

logger = logging.getLogger(__name__)

# global docket instance - initialized in lifespan (None if disabled)
_docket: Docket | None = None
_docket_enabled: bool = False


def is_docket_enabled() -> bool:
    """check if docket is enabled and initialized."""
    return _docket_enabled and _docket is not None


def get_docket() -> Docket:
    """get the global docket instance.

    raises:
        RuntimeError: if docket is not initialized or disabled
    """
    if not _docket_enabled:
        raise RuntimeError("docket is disabled - set DOCKET_URL to enable")
    if _docket is None:
        raise RuntimeError("docket not initialized - is the server running?")
    return _docket


@asynccontextmanager
async def background_worker_lifespan() -> AsyncGenerator[Docket | None, None]:
    """lifespan context manager for docket and its worker.

    if DOCKET_URL is not set, docket is disabled and this yields None.
    when enabled, initializes the docket connection and starts an in-process
    worker that processes background tasks.

    yields:
        Docket | None: the initialized docket instance, or None if disabled
    """
    global _docket, _docket_enabled

    # check if docket should be enabled
    if not settings.docket.url:
        logger.info("docket disabled (DOCKET_URL not set)")
        _docket_enabled = False
        yield None
        return

    _docket_enabled = True
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
            _docket_enabled = False
            logger.info("docket worker stopped")


def _register_tasks(docket: Docket) -> None:
    """register all background task functions with the docket.

    tasks must be registered before they can be executed by workers.
    add new task imports here as they're created.
    """
    # import task functions here to avoid circular imports
    from backend._internal.background_tasks import scan_copyright

    docket.register(scan_copyright)

    logger.info(
        "registered background tasks",
        extra={"tasks": ["scan_copyright"]},
    )
