from copy import deepcopy
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.atproto.records.fm_plyr.track import update_record
from backend._internal.atproto.tag_sync import sync_track_tags
from backend._internal.clients.moderation import ModerationClient
from backend._internal.tasks.ingest import ingest_track_create, ingest_track_update
from backend.models import Track
from backend.utilities.track_tags import indexed_tags, project_record_tags
from tests.api.test_track_edit_pds_sync import MockSession, published_track, test_app

__all__ = ["published_track", "test_app"]


class PdsRepository:
    def __init__(self, track: Track) -> None:
        self.uri = track.atproto_record_uri
        self.cid = "original"
        self.rev = "00001"
        self.value: dict[str, Any] = {
            "$type": "fm.plyr.track",
            "title": track.title,
            "artist": "Editor",
            "fileType": "mp3",
            "audioBlob": {"ref": {"$link": "blob"}},
            "createdAt": track.created_at.isoformat(),
            "tags": ["ai"],
            "example.extension": {"keep": True},
        }
        self.fail = False
        self.writes = 0

    async def request(
        self,
        auth: Session,
        method: str,
        nsid: str,
        payload: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        if method == "POST":
            assert payload is not None
            if self.fail or payload["swapRecord"] != self.cid:
                raise RuntimeError("InvalidSwap")
            self.value = deepcopy(payload["record"])
            self.writes += 1
            self.cid = f"written-{self.writes}"
            self.rev = f"{self.writes + 1:05}"
        return {
            "uri": self.uri,
            "cid": self.cid,
            "value": deepcopy(self.value),
            "commit": {"rev": self.rev},
        }


@pytest.fixture
def pds(published_track: Track, monkeypatch: pytest.MonkeyPatch) -> PdsRepository:
    repo = PdsRepository(published_track)
    monkeypatch.setattr(
        "backend._internal.atproto.records.fm_plyr.track.make_pds_request", repo.request
    )
    return repo


@pytest.fixture(autouse=True)
def moderation(monkeypatch: pytest.MonkeyPatch) -> None:
    async def decisions(self: ModerationClient, uris: list[str]) -> dict[str, None]:
        return dict.fromkeys(uris)

    monkeypatch.setattr(ModerationClient, "get_indexing_decisions", decisions)


@pytest.mark.parametrize("tags", ['["ambient"]', "[]"])
async def test_tag_edit_publishes_to_pds(
    test_app: FastAPI,
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
    tags: str,
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/{published_track.id}", data={"tags": tags}
        )
    assert response.status_code == 200, response.text
    assert pds.writes == 1
    assert sorted(pds.value["tags"]) == response.json()["tags"]
    assert await indexed_tags(db_session, published_track.id) == sorted(
        pds.value["tags"]
    )
    assert pds.value["example.extension"] == {"keep": True}


async def test_metadata_edit_preserves_pds_tags(
    test_app: FastAPI,
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
) -> None:
    created_at = pds.value["createdAt"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/{published_track.id}", data={"title": "new title"}
        )
    assert response.status_code == 200, response.text
    assert pds.value["tags"] == ["ai"]
    assert response.json()["tags"] == ["ai"]
    assert pds.value["createdAt"] == created_at


async def test_failed_write_does_not_change_index(
    test_app: FastAPI,
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
) -> None:
    await project_record_tags(db_session, published_track, {"tags": ["ai"]})
    await db_session.commit()
    pds.fail = True
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/{published_track.id}", data={"tags": "[]"}
        )
    assert response.status_code == 500
    assert await indexed_tags(db_session, published_track.id) == ["ai"]
    assert pds.value["tags"] == ["ai"]


async def seed_legacy(db: AsyncSession, track: Track) -> None:
    await project_record_tags(db, track, {"tags": ["legacy"]})
    track.extra = {"duration": 180}
    await db.commit()


@pytest.mark.parametrize("remote", [None, [], ["ai"]])
async def test_migration_respects_pds(
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
    remote: list[str] | None,
) -> None:
    await seed_legacy(db_session, published_track)
    if remote is None:
        del pds.value["tags"]
    else:
        pds.value["tags"] = remote
    await sync_track_tags(published_track.id, MockSession())
    expected = ["legacy"] if remote is None else remote
    assert await indexed_tags(db_session, published_track.id) == expected
    assert pds.value["tags"] == expected
    assert pds.writes == (1 if remote is None else 0)
    await db_session.refresh(published_track)
    assert published_track.extra["tags_pds_synced"] is True
    if remote is not None:
        assert published_track.extra["legacy_tags"] == ["legacy"]
    await sync_track_tags(published_track.id, MockSession())
    assert pds.writes == (1 if remote is None else 0)


async def test_missing_tags_preserve_legacy_then_clear_migrated(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository
) -> None:
    await seed_legacy(db_session, published_track)
    assert published_track.atproto_record_uri is not None
    args = (published_track.artist_did, "editsync")
    await ingest_track_update(
        *args,
        {"title": "old client"},
        published_track.atproto_record_uri,
        "legacy",
        rev="00001",
    )
    assert await indexed_tags(db_session, published_track.id) == ["legacy"]
    await ingest_track_update(
        *args,
        {"tags": ["ai"]},
        published_track.atproto_record_uri,
        "tagged",
        rev="00002",
    )
    assert await indexed_tags(db_session, published_track.id) == ["ai"]
    await ingest_track_update(
        *args, {}, published_track.atproto_record_uri, "cleared", rev="00003"
    )
    assert await indexed_tags(db_session, published_track.id) == []
    await ingest_track_update(
        *args,
        {"tags": ["ai"]},
        published_track.atproto_record_uri,
        "stale",
        rev="00002",
    )
    assert await indexed_tags(db_session, published_track.id) == []


@pytest.mark.parametrize(
    "tags", [None, "ai", [1], ["x" * 51], [str(i) for i in range(21)]]
)
async def test_invalid_tags_cannot_clear_index(
    db_session: AsyncSession, published_track: Track, tags: Any
) -> None:
    await project_record_tags(db_session, published_track, {"tags": ["ai"]})
    await db_session.commit()
    assert published_track.atproto_record_uri is not None
    await ingest_track_update(
        published_track.artist_did,
        "editsync",
        {"tags": tags},
        published_track.atproto_record_uri,
        "invalid",
    )
    assert await indexed_tags(db_session, published_track.id) == ["ai"]


async def test_direct_pds_create_indexes_tags(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository
) -> None:
    uri = f"at://{published_track.artist_did}/fm.plyr.track/external"
    record = {k: v for k, v in pds.value.items() if k != "audioBlob"}
    record["audioBlob"] = {"ref": {"$link": "external-blob"}}
    with (
        patch(
            "backend._internal.tasks.ingest.run_post_track_create_hooks", AsyncMock()
        ),
        patch(
            "backend._internal.slingshot.resolve_mini_doc_safe",
            AsyncMock(return_value=None),
        ),
    ):
        await ingest_track_create(
            published_track.artist_did,
            "external",
            record,
            uri,
            "external-cid",
            rev="00001",
        )
    external = await db_session.scalar(
        select(Track).where(Track.atproto_record_uri == uri)
    )
    assert external is not None
    assert await indexed_tags(db_session, external.id) == ["ai"]


async def test_backfill_conflict_leaves_migration_pending(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository
) -> None:
    await seed_legacy(db_session, published_track)
    del pds.value["tags"]
    pds.fail = True
    with pytest.raises(RuntimeError, match="InvalidSwap"):
        await sync_track_tags(published_track.id, MockSession())
    await db_session.refresh(published_track)
    assert not published_track.extra.get("tags_pds_synced")
    assert await indexed_tags(db_session, published_track.id) == ["legacy"]
    pds.fail = False
    pds.value["tags"] = []
    await sync_track_tags(published_track.id, MockSession())
    assert await indexed_tags(db_session, published_track.id) == []
    assert pds.writes == 0


async def test_auto_tags_publish_before_projection(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository
) -> None:
    await project_record_tags(db_session, published_track, {"tags": ["ai"]})
    published_track.extra = {
        "auto_tag": True,
        "genre_predictions_file_id": published_track.file_id,
        "genre_predictions": [{"name": "Ambient", "confidence": 0.9}],
    }
    await db_session.commit()
    pds.fail = True
    with pytest.raises(RuntimeError, match="InvalidSwap"):
        await sync_track_tags(published_track.id, MockSession())
    assert await indexed_tags(db_session, published_track.id) == ["ai"]
    await db_session.refresh(published_track)
    assert published_track.extra["auto_tag"]
    pds.fail = False
    await sync_track_tags(published_track.id, MockSession())
    assert set(pds.value["tags"]) == {"ai", "ambient"}
    assert await indexed_tags(db_session, published_track.id) == ["ai", "ambient"]
    await db_session.refresh(published_track)
    assert "auto_tag" not in published_track.extra


async def test_own_write_revision_rejects_older_echo(
    test_app: FastAPI,
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/{published_track.id}", data={"tags": "[]"}
        )
    assert response.status_code == 200, response.text
    assert published_track.atproto_record_uri is not None
    await ingest_track_update(
        published_track.artist_did,
        "editsync",
        {"tags": ["ai"]},
        published_track.atproto_record_uri,
        "old",
        rev="00001",
    )
    assert await indexed_tags(db_session, published_track.id) == []


async def test_tag_edit_preserves_unindexed_metadata(
    test_app: FastAPI,
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
) -> None:
    pds.value["title"] = "edited externally"
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/{published_track.id}", data={"tags": '["ambient"]'}
        )
    assert response.status_code == 200, response.text
    assert pds.value["title"] == "edited externally"
    assert pds.value["audioBlob"] == {"ref": {"$link": "blob"}}


async def test_own_echo_projects_unindexed_metadata(
    test_app: FastAPI,
    db_session: AsyncSession,
    published_track: Track,
    pds: PdsRepository,
) -> None:
    published_track.pds_blob_cid = "blob"
    await db_session.commit()
    pds.value["title"] = "external title before our tag edit"
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/{published_track.id}", data={"tags": "[]"}
        )
    assert response.status_code == 200, response.text
    assert published_track.atproto_record_uri is not None
    await ingest_track_update(
        published_track.artist_did,
        "editsync",
        pds.value,
        published_track.atproto_record_uri,
        pds.cid,
        rev=pds.rev,
    )
    await db_session.refresh(published_track)
    assert published_track.title == "external title before our tag edit"
    assert await indexed_tags(db_session, published_track.id) == []


async def test_background_rebuild_preserves_tags_and_extensions(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository
) -> None:
    assert published_track.atproto_record_uri is not None
    created_at = pds.value["createdAt"]
    await update_record(
        MockSession(),
        published_track.atproto_record_uri,
        {
            "$type": "fm.plyr.track",
            "title": "rebuilt",
            "artist": "Editor",
            "fileType": "mp3",
            "audioUrl": "https://audio.example/rebuilt.mp3",
            "createdAt": "2026-10-21T00:00:00Z",
        },
    )
    assert pds.value["tags"] == ["ai"]
    assert pds.value["example.extension"] == {"keep": True}
    assert pds.value["createdAt"] == created_at
    assert "audioBlob" not in pds.value


async def test_backfill_keeps_legacy_tags_above_editor_limit(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository
) -> None:
    tags = [f"legacy-{i:02}" for i in range(11)]
    await project_record_tags(db_session, published_track, {"tags": tags})
    published_track.extra = {}
    await db_session.commit()
    del pds.value["tags"]
    await sync_track_tags(published_track.id, MockSession())
    assert pds.value["tags"] == tags
    assert await indexed_tags(db_session, published_track.id) == tags


@pytest.mark.parametrize("missing", [False, True])
async def test_external_tag_change_cancels_pending_auto_tags(
    db_session: AsyncSession, published_track: Track, pds: PdsRepository, missing: bool
) -> None:
    await project_record_tags(db_session, published_track, {"tags": ["ai"]})
    published_track.extra = {
        **published_track.extra,
        "auto_tag": True,
        "genre_predictions_file_id": published_track.file_id,
        "genre_predictions": [{"name": "ambient", "confidence": 0.9}],
    }
    await db_session.commit()
    if missing:
        del pds.value["tags"]
    else:
        pds.value["tags"] = []
    await sync_track_tags(published_track.id, MockSession())
    assert pds.writes == 0
    assert await indexed_tags(db_session, published_track.id) == []
    await db_session.refresh(published_track)
    assert "auto_tag" not in published_track.extra
