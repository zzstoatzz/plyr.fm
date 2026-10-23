from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api import activity
from backend.models import (
    Artist,
    CollectionEvent,
    Playlist,
    Track,
    TrackComment,
    TrackLike,
    TrackPlay,
)

NOW = datetime(2026, 10, 19, 17, 30, tzinfo=UTC)


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz: object = None) -> datetime:
        return NOW


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(activity, "datetime", FrozenDatetime)


@pytest.fixture(autouse=True)
async def clear_historical_rows(db_session: AsyncSession) -> AsyncIterator[None]:
    yield
    await db_session.rollback()
    await db_session.execute(
        text("CALL clear_database(:start_time)"),
        {"start_time": datetime(1970, 1, 1, tzinfo=UTC)},
    )
    await db_session.commit()


@pytest.mark.parametrize(
    ("range_name", "interval", "length", "start"),
    [
        ("day", "hour", 24, NOW.replace(minute=0) - timedelta(hours=23)),
        ("week", "hour", 168, NOW.replace(minute=0) - timedelta(hours=167)),
        ("month", "day", 30, NOW.replace(hour=0, minute=0) - timedelta(days=29)),
        ("year", "day", 365, NOW.replace(hour=0, minute=0) - timedelta(days=364)),
    ],
)
async def test_range_boundaries_and_zero_fill(
    client: TestClient,
    db_session: AsyncSession,
    range_name: str,
    interval: str,
    length: int,
    start: datetime,
) -> None:
    for index, timestamp in enumerate(
        [start - timedelta(microseconds=1), start, NOW, NOW + timedelta(seconds=1)]
    ):
        db_session.add(
            Artist(
                did=f"did:plc:histogram{index}",
                handle=f"artist{index}.test",
                display_name="artist",
                created_at=timestamp,
            )
        )
    await db_session.commit()

    response = client.get("/activity/histogram", params={"range": range_name})
    assert response.status_code == 200
    data = response.json()
    assert data["interval"] == interval
    assert len(data["buckets"]) == length
    assert data["buckets"][0]["count"] == 1
    assert data["buckets"][-1]["count"] == 1
    assert sum(bucket["count"] for bucket in data["buckets"]) == 2
    assert (
        datetime.fromisoformat(data["buckets"][0]["date"]).replace(tzinfo=UTC) == start
    )


async def test_legacy_days_includes_whole_first_day(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    db_session.add(
        Artist(
            did="did:plc:early",
            handle="early.test",
            display_name="early",
            created_at=NOW.replace(hour=0, minute=1) - timedelta(days=6),
        )
    )
    await db_session.commit()
    buckets = client.get("/activity/histogram?days=7").json()["buckets"]
    assert len(buckets) == 7
    assert buckets[0] == {"date": "2026-10-13", "count": 1}


async def test_all_time_starts_at_launch_and_drops_backdated_events(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    for did, created_at in [
        ("did:plc:backdated", datetime(2021, 1, 1, tzinfo=UTC)),
        ("did:plc:launch", datetime(2025, 10, 28, tzinfo=UTC)),
    ]:
        db_session.add(
            Artist(
                did=did,
                handle=f"{did[8:]}.test",
                display_name="a",
                created_at=created_at,
            )
        )
    await db_session.commit()
    data = client.get("/activity/histogram?range=all").json()
    assert data["interval"] == "month"
    assert len(data["buckets"]) == 13
    assert data["buckets"][0] == {"date": "2025-10-01T00:00:00+00:00", "count": 1}
    assert sum(bucket["count"] for bucket in data["buckets"]) == 1


async def test_empty_all_time_and_invalid_range(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    buckets = client.get("/activity/histogram?range=all").json()["buckets"]
    assert len(buckets) == 13
    assert buckets[0] == {"date": "2025-10-01T00:00:00+00:00", "count": 0}
    assert all(bucket["count"] == 0 for bucket in buckets)
    assert client.get("/activity/histogram?range=century").status_code == 422
    assert client.get("/activity/histogram?days=0").status_code == 422
    assert client.get("/activity/histogram?series=likes").status_code == 422


async def test_plays_series_counts_plays_not_activity(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    artist = Artist(did="did:plc:plays", handle="plays.test", display_name="p")
    track = Track(
        title="t",
        file_id="plays",
        file_type="mp3",
        artist_did=artist.did,
        created_at=NOW,
    )
    db_session.add_all([artist, track])
    await db_session.flush()
    db_session.add_all(
        [
            TrackPlay(
                track_id=track.id, played_at=NOW - timedelta(days=3), source="teal"
            ),
            TrackPlay(
                track_id=track.id, played_at=NOW - timedelta(days=1), source="web"
            ),
            TrackPlay(track_id=track.id, played_at=NOW, source="subsonic"),
            TrackPlay(
                track_id=track.id,
                played_at=NOW - timedelta(hours=1),
                source="teal",
            ),
        ]
    )
    await db_session.commit()

    plays = client.get("/activity/histogram?range=week&series=plays").json()
    assert plays["series"] == "plays"
    assert len(plays["buckets"]) == 168
    assert sum(bucket["count"] for bucket in plays["buckets"]) == 3
    assert plays["tracked_since"] == (NOW - timedelta(days=1)).isoformat().replace(
        "+00:00", "Z"
    )

    activity_data = client.get("/activity/histogram?range=week").json()
    assert activity_data["series"] == "activity"
    assert activity_data["tracked_since"] is None
    assert sum(bucket["count"] for bucket in activity_data["buckets"]) == 1


async def test_plays_series_without_plays_is_zero_filled(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    data = client.get("/activity/histogram?range=month&series=plays").json()
    assert len(data["buckets"]) == 30
    assert all(bucket["count"] == 0 for bucket in data["buckets"])
    assert data["tracked_since"] is None


async def test_counts_feed_events_but_not_private_collections(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    artist = Artist(
        did="did:plc:counts",
        handle="counts.test",
        display_name="counts",
        created_at=NOW,
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="track",
        artist_did=artist.did,
        file_id="histogram",
        file_type="mp3",
        created_at=NOW,
    )
    playlist = Playlist(
        id="histogram-private", name="private", owner_did=artist.did, is_private=True
    )
    db_session.add_all([track, playlist])
    await db_session.flush()
    db_session.add_all(
        [
            TrackLike(track_id=track.id, user_did=artist.did, created_at=NOW),
            TrackComment(
                track_id=track.id,
                user_did=artist.did,
                text="nice",
                timestamp_ms=0,
                created_at=NOW,
            ),
            CollectionEvent(
                event_type="playlist_create",
                actor_did=artist.did,
                playlist_id=playlist.id,
                created_at=NOW,
            ),
            Artist(
                did="did:plc:incomplete", handle="", display_name="", created_at=NOW
            ),
        ]
    )
    await db_session.commit()
    feed = client.get("/activity/").json()["events"]
    buckets = client.get("/activity/histogram?range=day").json()["buckets"]
    assert sum(bucket["count"] for bucket in buckets) == len(feed) == 4
