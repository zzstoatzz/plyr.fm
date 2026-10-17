"""Real worker subprocess for interruption and process-recovery tests."""

import asyncio
import logging
import signal
import sys
from datetime import timedelta

from docket import Docket, Worker
from redis.asyncio import Redis

from backend._internal.worker_lifecycle import supervised_worker


async def probe(redis_url: str, key: str, delay: float = 0) -> None:
    async with Redis.from_url(redis_url) as redis:
        await redis.set(f"{key}:started", "1")
        await asyncio.sleep(delay)
        await redis.set(key, "1")


async def main() -> None:
    name, url = sys.argv[1:]
    stop = asyncio.Event()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set)
    async with Docket(name=name, url=url) as docket:
        docket.register(probe)
        async with supervised_worker(
            Worker(
                docket,
                schedule_automatic_tasks=False,
                minimum_check_interval=timedelta(milliseconds=50),
                scheduling_resolution=timedelta(milliseconds=50),
                redelivery_timeout=timedelta(seconds=1),
            )
        ):
            print("ready", flush=True)
            await stop.wait()


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    asyncio.run(main())
