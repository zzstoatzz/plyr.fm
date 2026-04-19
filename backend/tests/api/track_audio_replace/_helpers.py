"""shared helpers (non-fixture) for the audio-replace test suite.

pytest fixtures live in `conftest.py`; everything in this file is plain
imports — call them as functions.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from unittest.mock import AsyncMock, patch

from backend._internal import Session
from backend._internal.audio import AudioFormat
from backend.api.tracks.audio_replace import ReplaceContext
from backend.api.tracks.uploads import (
    AudioInfo,
    PdsBlobResult,
    StorageResult,
)
from backend.models import Track

OWNER_DID = "did:plc:owner"
OTHER_DID = "did:plc:someone-else"
TRACK_URI = f"at://{OWNER_DID}/fm.plyr.track/3kabcdefghi23"


class MockSession(Session):
    """drop-in for require_auth that doesn't touch encryption."""

    def __init__(self, did: str = OWNER_DID):
        self.did = did
        self.handle = "owner.bsky.social"
        self.session_id = "session-id"
        self.access_token = "tok"
        self.refresh_token = "ref"
        self.oauth_session = {
            "did": did,
            "handle": "owner.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "tok",
            "refresh_token": "ref",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


def make_track(
    *,
    artist_did: str = OWNER_DID,
    file_id: str = "old-file-id",
    file_type: str = "mp3",
    record_uri: str | None = TRACK_URI,
    record_cid: str | None = "bafyOLD",
    duration: int | None = 120,
    album_id: str | None = None,
    support_gate: dict | None = None,
    auto_tag: bool = False,
) -> Track:
    extra: dict = {}
    if duration is not None:
        extra["duration"] = duration
    if auto_tag:
        extra["auto_tag"] = True
    return Track(
        title="My Song",
        artist_did=artist_did,
        file_id=file_id,
        file_type=file_type,
        original_file_id=None,
        original_file_type=None,
        extra=extra,
        atproto_record_uri=record_uri,
        atproto_record_cid=record_cid,
        r2_url=f"https://audio.example/{file_id}.{file_type}",
        audio_storage="r2",
        pds_blob_cid=None,
        notification_sent=True,
        album_id=album_id,
        support_gate=support_gate,
    )


def replace_ctx(track_id: int = 1) -> ReplaceContext:
    return ReplaceContext(
        job_id="job-1",
        auth_session=MockSession(OWNER_DID),
        track_id=track_id,
        file_path="/tmp/fake-replacement.mp3",
        filename="replacement.mp3",
    )


def audio_info(duration: int = 200, is_gated: bool = False) -> AudioInfo:
    """default duration differs from `make_track` to verify the swap took."""
    return AudioInfo(format=AudioFormat.MP3, duration=duration, is_gated=is_gated)


def storage_result(
    *,
    file_id: str = "new-file-id",
    original_file_id: str | None = None,
    original_file_type: str | None = None,
    r2_url: str | None = "https://audio.example/new-file-id.mp3",
) -> StorageResult:
    return StorageResult(
        file_id=file_id,
        original_file_id=original_file_id,
        original_file_type=original_file_type,
        playable_format=AudioFormat.MP3,
        r2_url=r2_url,
        transcode_info=None,
    )


def pds_result(
    *, cid: str | None = "bafyNEWBLOB", size: int | None = 4096
) -> PdsBlobResult:
    return PdsBlobResult(
        blob_ref={"$type": "blob", "ref": {"$link": cid}, "size": size}
        if cid
        else None,
        cid=cid,
        size=size,
    )


@contextlib.contextmanager
def patched_replace_pipeline(
    *,
    validate: AudioInfo | None = None,
    store: StorageResult | None = None,
    pds: PdsBlobResult | None = None,
    update_record_return: tuple[str, str] = (TRACK_URI, "bafyNEWREC"),
    update_record_side_effect: object = None,
    storage_delete_side_effect: object = None,
    refreshed_session: Session | None = None,
) -> Iterator[dict]:
    """patch every external dependency of `_process_replace_background`.

    yields a dict of the mocks (`update_record`, `storage_delete`, `post_hooks`,
    `schedule_album_sync`) so tests can assert on them. lets each test focus
    on the one or two things it actually verifies.
    """
    update_record_kwargs: dict = (
        {"side_effect": update_record_side_effect}
        if update_record_side_effect is not None
        else {"return_value": update_record_return}
    )
    storage_delete_kwargs: dict = (
        {"side_effect": storage_delete_side_effect}
        if storage_delete_side_effect is not None
        else {"return_value": True}
    )

    with (
        patch(
            "backend.api.tracks.audio_replace._validate_audio",
            AsyncMock(return_value=validate or audio_info()),
        ),
        patch(
            "backend.api.tracks.audio_replace._store_audio",
            AsyncMock(return_value=store or storage_result()),
        ),
        patch(
            "backend.api.tracks.audio_replace._upload_to_pds",
            AsyncMock(return_value=pds if pds is not None else pds_result()),
        ),
        patch(
            "backend.api.tracks.audio_replace.update_record",
            AsyncMock(**update_record_kwargs),
        ) as mock_update_record,
        patch(
            "backend.api.tracks.audio_replace.storage.delete",
            AsyncMock(**storage_delete_kwargs),
        ) as mock_storage_delete,
        patch(
            "backend.api.tracks.audio_replace.run_post_track_audio_replace_hooks",
            new_callable=AsyncMock,
        ) as mock_hooks,
        patch(
            "backend.api.tracks.audio_replace.schedule_album_list_sync",
            new_callable=AsyncMock,
        ) as mock_album_sync,
        patch(
            "backend.api.albums.invalidate_album_cache_by_id",
            new_callable=AsyncMock,
        ),
        patch(
            "backend.api.tracks.audio_replace.invalidate_tracks_discovery_cache",
            new_callable=AsyncMock,
        ),
        patch(
            "backend.api.tracks.audio_replace.get_session",
            AsyncMock(return_value=refreshed_session),
        ),
        patch("backend.api.tracks.audio_replace.job_service", AsyncMock()),
        patch("pathlib.Path.unlink"),
    ):
        yield {
            "update_record": mock_update_record,
            "storage_delete": mock_storage_delete,
            "post_hooks": mock_hooks,
            "schedule_album_sync": mock_album_sync,
        }
