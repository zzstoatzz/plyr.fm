"""account-subject labels: a label on an artist's DID hides their tracks
wherever the tag of the same name does."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session, require_auth
from backend._internal.tasks import sync_operator_labels
from backend.main import app
from backend.models import Artist, Track, TrackLike, UserPreferences, get_db

VIEWER_DID = "did:test:viewer"
LABELED_DID = "did:plc:labeledbot"
# conftest clears rows created after the test began, so nothing is backdated
FUTURE = timedelta(hours=1)


class ViewerSession(Session):
    def __init__(self) -> None:
        self.did = VIEWER_DID
        self.handle = "viewer.bsky.social"
        self.session_id = "viewer_session"
        self.access_token = "token"
        self.refresh_token = "refresh"
        self.oauth_session = {
            "did": VIEWER_DID,
            "handle": "viewer.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "token",
            "refresh_token": "refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def signed_in_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def session() -> Session:
        return ViewerSession()

    async def get_test_db():
        yield db_session

    app.dependency_overrides[require_auth] = session
    app.dependency_overrides[get_optional_session] = session
    app.dependency_overrides[get_db] = get_test_db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def anonymous_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def no_session() -> None:
        return None

    async def get_test_db():
        yield db_session

    app.dependency_overrides[get_optional_session] = no_session
    app.dependency_overrides[get_db] = get_test_db
    yield app
    app.dependency_overrides.clear()


async def _artist(db: AsyncSession, did: str, handle: str, labels: list[str]) -> Artist:
    artist = Artist(did=did, handle=handle, display_name=handle, operator_labels=labels)
    db.add(artist)
    await db.flush()
    return artist


async def _track(
    db: AsyncSession, artist: Artist, title: str, created_at: datetime
) -> Track:
    track = Track(
        title=title,
        artist_did=artist.did,
        file_id=f"file_{title.replace(' ', '_')}",
        file_type="mp3",
        extra={"duration": 60},
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/{title.replace(' ', '')}",
        atproto_record_cid=f"bafy{title.replace(' ', '')}",
        created_at=created_at,
    )
    db.add(track)
    await db.flush()
    return track


@pytest.fixture
async def catalog(db_session: AsyncSession) -> dict[str, Track]:
    """an untagged track from a labeled account and one from an unlabeled one."""
    now = datetime.now(UTC) + FUTURE
    bot = await _artist(db_session, LABELED_DID, "bot.example", ["ai"])
    human = await _artist(db_session, "did:plc:human", "human.example", [])
    tracks = {
        "bot": await _track(db_session, bot, "Bot Drone", now),
        "human": await _track(
            db_session, human, "Human Song", now - timedelta(minutes=1)
        ),
    }
    await db_session.commit()
    return tracks


async def _titles(app_: FastAPI, path: str) -> list[str]:
    async with AsyncClient(
        transport=ASGITransport(app=app_), base_url="http://test"
    ) as client:
        response = await client.get(path)
    assert response.status_code == 200, response.text
    return [t["title"] for t in response.json()["tracks"]]


async def test_anonymous_latest_hides_labeled_account(
    anonymous_app: FastAPI, catalog: dict[str, Track]
) -> None:
    titles = await _titles(anonymous_app, "/tracks/?limit=50")
    assert "Human Song" in titles
    assert "Bot Drone" not in titles


async def test_listener_who_unhides_ai_sees_labeled_account(
    signed_in_app: FastAPI, db_session: AsyncSession, catalog: dict[str, Track]
) -> None:
    db_session.add(UserPreferences(did=VIEWER_DID, hidden_tags=[]))
    await db_session.commit()

    titles = await _titles(signed_in_app, "/tracks/")
    assert {"Human Song", "Bot Drone"} <= set(titles)


async def test_listener_hiding_only_suno_sees_labeled_account(
    signed_in_app: FastAPI, db_session: AsyncSession, catalog: dict[str, Track]
) -> None:
    """the label hides only for listeners who hide the tag of the same name."""
    db_session.add(UserPreferences(did=VIEWER_DID, hidden_tags=["suno"]))
    await db_session.commit()

    titles = await _titles(signed_in_app, "/tracks/")
    assert "Bot Drone" in titles


async def test_device_hidden_tags_still_hide_labeled_account(
    anonymous_app: FastAPI, catalog: dict[str, Track]
) -> None:
    """a signed-out app's own list keeps the account label in force."""
    titles = await _titles(anonymous_app, "/tracks/?hidden_tags=ai&hidden_tags=lofi")
    assert "Human Song" in titles
    assert "Bot Drone" not in titles


async def test_device_hidden_tags_without_ai_show_labeled_account(
    anonymous_app: FastAPI, catalog: dict[str, Track]
) -> None:
    titles = await _titles(anonymous_app, "/tracks/?hidden_tags=suno")
    assert {"Human Song", "Bot Drone"} <= set(titles)


async def test_device_hidden_tags_replace_saved_ones(
    signed_in_app: FastAPI, db_session: AsyncSession, catalog: dict[str, Track]
) -> None:
    db_session.add(UserPreferences(did=VIEWER_DID, hidden_tags=[]))
    await db_session.commit()

    titles = await _titles(signed_in_app, "/tracks/?hidden_tags=ai")
    assert "Bot Drone" not in titles


async def test_artist_page_lists_labeled_account_tracks(
    anonymous_app: FastAPI, catalog: dict[str, Track]
) -> None:
    titles = await _titles(anonymous_app, f"/tracks/?artist_did={LABELED_DID}")
    assert titles == ["Bot Drone"]


async def test_latest_pages_stay_full_around_labeled_tracks(
    anonymous_app: FastAPI, db_session: AsyncSession
) -> None:
    """the filter is SQL, so a page is full and has_more is honest even when
    labeled tracks interleave with visible ones."""
    now = datetime.now(UTC) + FUTURE
    bot = await _artist(db_session, LABELED_DID, "bot.example", ["ai"])
    human = await _artist(db_session, "did:plc:human", "human.example", [])
    for i in range(3):
        await _track(db_session, bot, f"Bot {i}", now - timedelta(minutes=2 * i))
        await _track(
            db_session, human, f"Human {i}", now - timedelta(minutes=2 * i + 1)
        )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=anonymous_app), base_url="http://test"
    ) as client:
        first = (await client.get("/tracks/", params={"limit": 2})).json()
        second = (
            await client.get(
                "/tracks/", params={"limit": 2, "cursor": first["next_cursor"]}
            )
        ).json()

    assert [t["title"] for t in first["tracks"]] == ["Human 0", "Human 1"]
    assert first["has_more"] is True
    assert [t["title"] for t in second["tracks"]] == ["Human 2"]
    assert second["has_more"] is False


async def test_for_you_drops_labeled_account(
    signed_in_app: FastAPI, db_session: AsyncSession, catalog: dict[str, Track]
) -> None:
    for track in catalog.values():
        db_session.add(TrackLike(track_id=track.id, user_did="did:test:someone"))
    await db_session.commit()

    titles = await _titles(signed_in_app, "/for-you/")
    assert "Human Song" in titles
    assert "Bot Drone" not in titles


async def test_sync_projects_account_labels_onto_artists(
    db_session: AsyncSession,
) -> None:
    """DID subjects land on artists, record URIs on tracks, and a value from
    one family never leaks into the other's projection."""
    bot = await _artist(db_session, LABELED_DID, "bot.example", [])
    stale = await _artist(db_session, "did:plc:unlabeled", "stale.example", ["ai"])
    track = await _track(db_session, bot, "Bot Drone", datetime.now(UTC) + FUTURE)
    await db_session.commit()

    with patch(
        "backend._internal.clients.moderation.get_moderation_client"
    ) as get_client:
        client = AsyncMock()
        client.get_active_labels_by_value.return_value = {
            LABELED_DID: {"ai", "sexual"},
            track.atproto_record_uri: {"sexual", "ai"},
        }
        client.get_moderation_overrides.return_value = {}
        get_client.return_value = client

        await sync_operator_labels()

    requested = client.get_active_labels_by_value.await_args.args[0]
    assert "ai" in requested

    await db_session.refresh(bot)
    await db_session.refresh(stale)
    await db_session.refresh(track)
    assert bot.operator_labels == ["ai"]
    assert stale.operator_labels == []
    assert track.operator_labels == ["sexual"]
