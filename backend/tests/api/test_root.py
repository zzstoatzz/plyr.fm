"""the bare server URL must answer 200: subsonic clients (Amperfy) probe it
for reachability before attempting /rest endpoints."""

from httpx import ASGITransport, AsyncClient

from backend.main import app


async def test_root_returns_200() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/")
    assert response.status_code == 200
    assert response.json()["service"] == "plyr.fm api"
