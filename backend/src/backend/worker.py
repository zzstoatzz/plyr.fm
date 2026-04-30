"""docket worker entrypoint.

run via:
    uv run --no-sync python -m backend.worker

this is the standalone worker process — no uvicorn, no HTTP serving.
matches the `worker` process group in `backend/fly.toml`.

we don't shell out to the upstream `docket` CLI because observability is
app-owned: `configure_observability()` (logfire + logging) needs to run
before any task module is imported, and the upstream CLI does not run
plyr-specific setup.

services initialized here are deliberately a subset of `main.py`'s
lifespan — only the ones used by *registered docket tasks*. specifically
`notification_service`, which `tasks/hooks.py:200`,
`tasks/moderation.py:46`, and `_internal/moderation.py:170` (the
copyright scanner, called from `tasks/copyright.py`) all reach into.
without setup the bsky DM client and `recipient_did` stay None, so
notifications silently no-op while `track.notification_sent` still gets
flipped to True — permanent silent loss. `queue_service` and
`jam_service` are HTTP-only and intentionally omitted.
"""

import asyncio
import logging
import signal

from backend._internal import notification_service
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
        # services used by registered tasks must be set up before the
        # worker starts processing. setup is best-effort: if bsky auth
        # fails, notification_service.setup() logs and leaves the client
        # disabled rather than raising — same as in the HTTP lifespan.
        await notification_service.setup()
        try:
            async with docket_worker_lifespan():
                logger.info("worker process ready")
                await stop.wait()
                logger.info("shutdown signal received, draining worker")
        finally:
            try:
                await asyncio.wait_for(notification_service.shutdown(), timeout=2.0)
            except TimeoutError:
                logger.warning("notification_service.shutdown() timed out")
    finally:
        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
