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


async def test_all_time_includes_old_events_and_empty_months(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    db_session.add(
        Artist(
            did="did:plc:old",
            handle="old.test",
            display_name="old",
            created_at=datetime(2024, 2, 29, 23, 59, tzinfo=UTC),
        )
    )
    await db_session.commit()
    data = client.get("/activity/histogram?range=all").json()
    assert data["interval"] == "month"
    assert len(data["buckets"]) == 33
    assert data["buckets"][0] == {"date": "2024-02-01T00:00:00+00:00", "count": 1}
    assert sum(bucket["count"] for bucket in data["buckets"][1:]) == 0


async def test_empty_all_time_and_invalid_range(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    assert client.get("/activity/histogram?range=all").json()["buckets"] == [
        {"date": "2026-10-01T00:00:00+00:00", "count": 0}
    ]
    assert client.get("/activity/histogram?range=century").status_code == 422
    assert client.get("/activity/histogram?days=0").status_code == 422


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
