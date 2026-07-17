"""regression tests for /tracks/me search (q) and sort params.

covers:
- q filters by title (case-insensitive) and adjusts total/has_more
- LIKE wildcards in q are escaped (a literal "%" must not match everything)
- blank/whitespace q is treated as no filter
- each sort mode orders correctly, with id tie-breakers keeping
  offset pagination stable on equal sort keys
"""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track

_DID = "did:plc:search_sort_artist"


class MockSession(Session):
    """mock session for auth bypass."""

    def __init__(self, did: str = _DID):
        self.did = did
        self.handle = "searchsort.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "searchsort.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.pop(require_auth, None)


async def _make_track(
    db_session: AsyncSession,
    *,
    title: str,
    file_id: str,
    created_at: datetime | None = None,
    plays: int = 0,
) -> Track:
    # NOTE: leave created_at unset (server default ~now) unless a test needs a
    # specific order — the test-db clear procedure only deletes rows with
    # created_at > test-start, so back-dated rows would leak across tests.
    track = Track(
        title=title,
        artist_did=_DID,
        file_id=file_id,
        file_type="mp3",
        play_count=plays,
        **({"created_at": created_at} if created_at else {}),
    )
    db_session.add(track)
    return track


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    artist = Artist(did=_DID, handle="searchsort.bsky.social", display_name="Searcher")
    db_session.add(artist)
    await db_session.commit()
    return artist


async def _get(test_app: FastAPI, query: str = "") -> dict:
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/tracks/me{query}")
    assert response.status_code == 200, response.text
    return response.json()


async def test_q_filters_and_adjusts_total(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    await _make_track(db_session, title="Alpha Song", file_id="ss_a")
    await _make_track(db_session, title="Beta Song", file_id="ss_b")
    await _make_track(db_session, title="Gamma", file_id="ss_c")
    await db_session.commit()

    data = await _get(test_app, "?q=song")
    titles = {t["title"] for t in data["tracks"]}
    assert titles == {"Alpha Song", "Beta Song"}
    # total + has_more reflect the FILTERED set, not the full library
    assert data["total"] == 2
    assert data["has_more"] is False


async def test_q_is_case_insensitive(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    await _make_track(db_session, title="Alpha Song", file_id="ci_a")
    await db_session.commit()

    data = await _get(test_app, "?q=ALPHA")
    assert [t["title"] for t in data["tracks"]] == ["Alpha Song"]


async def test_q_wildcards_are_escaped(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    # a literal "%" in the query must match only the track containing "%",
    # not act as a wildcard that matches every track.
    await _make_track(db_session, title="100% Pure", file_id="wc_a")
    await _make_track(db_session, title="Plain Track", file_id="wc_b")
    await db_session.commit()

    data = await _get(test_app, "?q=%25")  # %25 == "%"
    assert [t["title"] for t in data["tracks"]] == ["100% Pure"]
    assert data["total"] == 1


async def test_blank_q_is_no_filter(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    await _make_track(db_session, title="One", file_id="bl_a")
    await _make_track(db_session, title="Two", file_id="bl_b")
    await db_session.commit()

    data = await _get(test_app, "?q=%20%20")  # whitespace only
    assert data["total"] == 2


async def test_creator_track_response_separates_operator_labels(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    track = await _make_track(
        db_session, title="Independently labeled", file_id="operator_label"
    )
    track.self_labels = ["sexual"]
    await db_session.commit()

    operator_labels = AsyncMock(return_value={track.id: {"sexual", "porn"}})
    with patch("backend.api.tracks.listing.get_operator_label_values", operator_labels):
        data = await _get(test_app)

    response_track = data["tracks"][0]
    assert response_track["self_labels"] == ["sexual"]
    assert set(response_track["operator_labels"]) == {"sexual", "porn"}
    assert set(response_track["labels"]) == {"sexual", "porn"}


async def test_sort_title_alphabetical(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    await _make_track(db_session, title="zebra", file_id="st_z")
    await _make_track(db_session, title="Apple", file_id="st_a")
    await _make_track(db_session, title="mango", file_id="st_m")
    await db_session.commit()

    data = await _get(test_app, "?sort=title")
    # case-insensitive ascending
    assert [t["title"] for t in data["tracks"]] == ["Apple", "mango", "zebra"]


async def test_sort_plays_descending(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    await _make_track(db_session, title="low", file_id="sp_l", plays=1)
    await _make_track(db_session, title="high", file_id="sp_h", plays=99)
    await _make_track(db_session, title="mid", file_id="sp_m", plays=50)
    await db_session.commit()

    data = await _get(test_app, "?sort=plays")
    assert [t["title"] for t in data["tracks"]] == ["high", "mid", "low"]


async def test_sort_recent_is_default(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    base = datetime.now(UTC)
    await _make_track(db_session, title="oldest", file_id="sr_o", created_at=base)
    await _make_track(
        db_session,
        title="newest",
        file_id="sr_n",
        created_at=base + timedelta(minutes=2),
    )
    await _make_track(
        db_session,
        title="middle",
        file_id="sr_m",
        created_at=base + timedelta(minutes=1),
    )
    await db_session.commit()

    data = await _get(test_app)  # no sort param -> recent
    assert [t["title"] for t in data["tracks"]] == ["newest", "middle", "oldest"]


async def test_tie_breaker_keeps_pagination_stable(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    # three tracks with identical play_count: without an id tie-breaker,
    # offset pagination could repeat or drop rows across pages.
    for i in range(3):
        await _make_track(db_session, title=f"tied {i}", file_id=f"tb_{i}", plays=7)
    await db_session.commit()

    seen: list[int] = []
    for offset in range(3):
        data = await _get(test_app, f"?sort=plays&limit=1&offset={offset}")
        assert len(data["tracks"]) == 1
        seen.append(data["tracks"][0]["id"])

    assert len(set(seen)) == 3  # every page returned a distinct row
