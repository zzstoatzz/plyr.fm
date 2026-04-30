"""docket worker entrypoint.

run via:
    uv run --no-sync python -m backend.worker

this is the standalone worker process — no uvicorn, no HTTP serving.
matches the `worker` process group in `backend/fly.toml`.

we don't shell out to the upstream `docket` CLI because observability is
app-owned: `configure_observability()` (logfire + logging) needs to run
before any task module is imported, and the upstream CLI does not run
plyr-specific setup.
"""

import asyncio
import logging
import signal

from backend._internal.background import docket_worker_lifespan
from backend.config import settings
from backend.utilities.observability import (
    configure_observability,
    suppress_warnings,
)

# matches the order in main.py: suppress pydantic warnings before any
# atproto-touching task module gets imported, then configure logfire.
suppress_warnings()
configure_observability(settings)

logger = logging.getLogger(__name__)


async def _run() -> None:
    """run the docket worker until SIGINT/SIGTERM."""
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()

    def request_stop(sig_name: str) -> None:
        logger.info("received %s, initiating graceful shutdown", sig_name)
        stop.set()

    loop.add_signal_handler(signal.SIGTERM, lambda: request_stop("SIGTERM"))
    loop.add_signal_handler(signal.SIGINT, lambda: request_stop("SIGINT"))

    try:
        async with docket_worker_lifespan():
            logger.info("worker process ready")
            await stop.wait()
            logger.info("shutdown signal received, draining worker")
    finally:
        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
