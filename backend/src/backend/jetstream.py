"""dedicated jetstream consumer process.

run via:
    uv run --no-sync python -m backend.jetstream

this runs the Jetstream WebSocket consumer ISOLATED from the docket worker's
task-execution event loop. when the consumer ran as a docket task inside the
`worker` process, CPU/blocking tasks (copyright scans, genre classification,
exports) starved the WebSocket keepalive coroutine and the connection dropped
roughly every ~50s. on its own quiet event loop it stays connected.

this process opens a docket *client* only — it enqueues ingest tasks; the
`worker` process consumes them. matches the `jetstream` process group in
`backend/fly.toml`. run a single instance: two consumers would double-process
the firehose (the ingest tasks are idempotent, so it's wasteful, not unsafe).

observability is app-owned, same as `backend/worker.py`: `configure_observability()`
must run before any task module is imported.
"""

import asyncio
import logging
import signal

from backend._internal.background import docket_client_lifespan
from backend._internal.jetstream import JetstreamConsumer
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
    """run the jetstream consumer until SIGINT/SIGTERM."""
    if not settings.jetstream.enabled:
        logger.info("jetstream disabled, exiting")
        return

    loop = asyncio.get_running_loop()
    consumer = JetstreamConsumer()

    def request_stop(sig_name: str) -> None:
        logger.info("received %s, stopping jetstream consumer", sig_name)
        consumer.stop()

    loop.add_signal_handler(signal.SIGTERM, lambda: request_stop("SIGTERM"))
    loop.add_signal_handler(signal.SIGINT, lambda: request_stop("SIGINT"))

    try:
        # a docket client (no Worker) so the consumer can enqueue ingest
        # tasks; the dedicated `worker` process runs the Worker that drains them.
        async with docket_client_lifespan():
            logger.info("jetstream process ready")
            await consumer.run()
    finally:
        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
