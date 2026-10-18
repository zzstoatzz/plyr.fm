import asyncio
from collections.abc import Iterator
from socketserver import BaseRequestHandler, ThreadingTCPServer
from threading import Event, Thread
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from backend.config import settings
from backend.utilities.rate_limit import RateLimitMiddleware, create_limiter


@pytest.fixture
def silent_redis() -> Iterator[tuple[str, Event]]:
    connected = Event()
    release = Event()

    class SilentHandler(BaseRequestHandler):
        def handle(self) -> None:
            connected.set()
            release.wait(5)

    with ThreadingTCPServer(("127.0.0.1", 0), SilentHandler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"redis://127.0.0.1:{server.server_address[1]}/0", connected
        finally:
            release.set()
            server.shutdown()
            thread.join()


@pytest.mark.parametrize("decorated", [False, True])
async def test_silent_redis_does_not_block_other_requests(
    silent_redis: tuple[str, Event], decorated: bool
) -> None:
    uri, connected = silent_redis
    limiter = create_limiter(uri, "2/minute")
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_middleware(RateLimitMiddleware)  # type: ignore[arg-type]

    async def limited(request: Request) -> dict[str, bool]:
        return {"ok": True}

    if decorated:
        limited = limiter.limit("2/minute")(limited)
    app.add_api_route("/limited", limited)

    @app.get("/health")
    @limiter.exempt
    async def health(request: Request) -> dict[str, bool]:
        return {"ok": True}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        pending = asyncio.create_task(client.get("/limited"))
        try:
            async with asyncio.timeout(2):
                while not connected.is_set():
                    await asyncio.sleep(0.005)
            assert (await client.get("/health")).status_code == 200
            assert not pending.done(), "Redis blocked the event loop until its timeout"
            assert (await asyncio.wait_for(pending, 2)).status_code == 200
            assert (await client.get("/limited")).status_code == 200
            assert (await client.get("/limited")).status_code == 429
        finally:
            await pending


async def test_default_and_decorated_limits_use_live_redis() -> None:
    limiter = create_limiter(settings.docket.url, "3/minute")
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_middleware(RateLimitMiddleware)  # type: ignore[arg-type]

    @app.get("/default")
    async def default(request: Request) -> dict[str, bool]:
        return {"ok": True}

    @app.get("/decorated")
    @limiter.limit("2/minute")
    async def decorated(request: Request) -> dict[str, bool]:
        return {"ok": True}

    @app.get("/exempt")
    @limiter.exempt
    async def exempt(request: Request) -> dict[str, bool]:
        return {"ok": True}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"authorization": f"test-{uuid4()}"},
    ) as client:
        assert [(await client.get("/default")).status_code for _ in range(4)] == [
            200,
            200,
            200,
            429,
        ]
        assert [(await client.get("/decorated")).status_code for _ in range(3)] == [
            200,
            200,
            429,
        ]
        assert [(await client.get("/exempt")).status_code for _ in range(4)] == [
            200,
            200,
            200,
            200,
        ]
        assert not limiter._storage_dead
