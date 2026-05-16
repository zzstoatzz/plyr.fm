"""regression tests for the copyright-paradigm review findings.

each test corresponds to one finding from the post-phase-3 review:
- P1.1: write_track_rights migrates audio + rebuilds the fm.plyr.track PDS record
- P2.1: write_track_rights rejects tracks that are already supporter-gated
- P1.2: /copyright/disconnect refuses with 409 when copyright tracks exist
- P2.2: listing/for_you supporter probe skips copyright-gated artists
- P3: TrackRightsInput rejects aggregate royalty splits over 100%

P3 is a pure pydantic test; the rest exercise the API/helpers through mocked PDS
+ docket dependencies so we don't need network or a real worker.
"""

from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.copyright import (
    TrackRightsInput,
    clear_track_rights,
    upsert_user_copyright_config,
    write_track_rights,
)
from backend.config import settings
from backend.main import app
from backend.models import Artist, Track, UserCopyrightConfig

# --- P3: royalty totals can't exceed 100% ------------------------------------


def test_p3_additional_mechanical_splits_under_100_percent_ok() -> None:
    """100% across additional parties with the primary at 0 is allowed."""
    rights = TrackRightsInput.model_validate(
        {
            "additionalInterestedParties": [
                {"name": "alice", "mechanicalRoyaltiesPercentage": 6000},
                {"name": "bob", "mechanicalRoyaltiesPercentage": 4000},
            ]
        }
    )
    assert len(rights.additional_interested_parties) == 2


def test_p3_additional_mechanical_splits_over_100_percent_rejected() -> None:
    """sum > 10000 is rejected before any PDS write happens."""
    with pytest.raises(ValidationError, match="mechanical royalty splits"):
        TrackRightsInput.model_validate(
            {
                "additionalInterestedParties": [
                    {"name": "alice", "mechanicalRoyaltiesPercentage": 8000},
                    {"name": "bob", "mechanicalRoyaltiesPercentage": 5000},
                ]
            }
        )


def test_p3_additional_performance_splits_over_100_percent_rejected() -> None:
    with pytest.raises(ValidationError, match="performance royalty splits"):
        TrackRightsInput.model_validate(
            {
                "additionalInterestedParties": [
                    {"name": "alice", "performanceRoyaltiesPercentage": 9000},
                    {"name": "bob", "performanceRoyaltiesPercentage": 2000},
                ]
            }
        )


# --- shared fixtures for the helper-level tests ------------------------------


@pytest.fixture
async def _user_with_paradigm(db_session: AsyncSession):
    """seed an artist + copyright config + feature flag for the test user DID."""
    from backend._internal import enable_flag

    did = "did:test:copyright-user"
    db_session.add(
        Artist(
            did=did,
            handle="copyright-user.bsky.social",
            display_name="Test Artist",
        )
    )
    await db_session.commit()
    await upsert_user_copyright_config(
        did=did,
        paradigm=settings.indiemusi.paradigm_id,
        config_uri="at://did:test:copyright-user/ch.indiemusi.alpha.actor.publishingOwner/abc",
        paradigm_data={
            "firstName": "Test",
            "lastName": "Artist",
            "ipi": "00000000000",
        },
    )
    # the feature-flag gate now wraps every /copyright/* endpoint; the
    # endpoint-level tests in this module exercise the in-flag path
    await enable_flag(db_session, did, "copyright-paradigm")
    await db_session.commit()
    yield did
    # let the session-scoped cleanup handle teardown


def _fake_session(did: str = "did:test:copyright-user") -> Session:
    s = Session.__new__(Session)
    s.did = did
    s.handle = "copyright-user.bsky.social"
    s.session_id = "test_session_id"
    s.access_token = "tok"
    s.refresh_token = "ref"
    s.oauth_session = {
        "did": did,
        "handle": s.handle,
        "pds_url": "https://test.pds",
        "authserver_iss": "https://auth.test",
        "scope": "atproto",
        "access_token": "tok",
        "refresh_token": "ref",
        "dpop_private_key_pem": "fake",
        "dpop_authserver_nonce": "",
        "dpop_pds_nonce": "",
    }
    return s


async def _insert_track(
    db: AsyncSession,
    did: str,
    *,
    title: str = "test track",
    support_gate: dict | None = None,
    r2_url: str | None = "https://audio.example.com/abc.mp3",
    copyright_song_uri: str | None = None,
) -> Track:
    track = Track(
        title=title,
        file_id="abc123",
        file_type="mp3",
        artist_did=did,
        r2_url=r2_url,
        atproto_record_uri=f"at://{did}/fm.plyr.track/xyz",
        support_gate=support_gate,
        copyright_song_uri=copyright_song_uri,
    )
    db.add(track)
    await db.commit()
    await db.refresh(track)
    return track


# --- P2.1: write_track_rights refuses non-copyright support_gate -------------


async def test_p2_1_write_track_rights_rejects_supporter_gated_track(
    _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """a track already carrying {"type":"any"} must not silently accept copyright."""
    track = await _insert_track(
        db_session, _user_with_paradigm, support_gate={"type": "any"}, r2_url=None
    )
    sess = _fake_session(_user_with_paradigm)

    with pytest.raises(ValueError, match="supporter-gated"):
        await write_track_rights(sess, track, TrackRightsInput())


async def test_p2_1_write_track_rights_accepts_already_copyright_gated(
    _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """idempotent updates to a copyright-gated track must still go through."""
    track = await _insert_track(
        db_session,
        _user_with_paradigm,
        support_gate={"type": "copyright"},
        r2_url=None,
        copyright_song_uri="at://did:test:copyright-user/ch.indiemusi.alpha.song/old",
    )
    sess = _fake_session(_user_with_paradigm)

    with (
        patch(
            "backend._internal.copyright.update_song_record",
            new_callable=AsyncMock,
        ) as up_song,
        patch(
            "backend._internal.copyright.create_recording_record",
            new_callable=AsyncMock,
        ) as cr_rec,
        patch(
            "backend._internal.copyright.rebuild_track_pds_record",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.copyright.schedule_move_track_audio",
            new_callable=AsyncMock,
        ) as sched_move,
    ):
        up_song.return_value = (
            "at://did:test:copyright-user/ch.indiemusi.alpha.song/old",
            "cid1",
        )
        cr_rec.return_value = (
            "at://did:test:copyright-user/ch.indiemusi.alpha.recording/new",
            "cid2",
        )
        await write_track_rights(sess, track, TrackRightsInput(iswc="T-1234567890"))

    # idempotent path: no transition, no move scheduled
    sched_move.assert_not_called()


# --- P1.1: write_track_rights migrates audio + rebuilds PDS record -----------


async def test_p1_1_public_to_copyright_schedules_move_and_rebuild(
    _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """a previously-public track must move to private and have its PDS record rebuilt."""
    track = await _insert_track(
        db_session,
        _user_with_paradigm,
        support_gate=None,
        r2_url="https://audio.example.com/abc.mp3",
    )
    sess = _fake_session(_user_with_paradigm)

    with (
        patch(
            "backend._internal.copyright.create_song_record",
            new_callable=AsyncMock,
        ) as cr_song,
        patch(
            "backend._internal.copyright.create_recording_record",
            new_callable=AsyncMock,
        ) as cr_rec,
        patch(
            "backend._internal.copyright.rebuild_track_pds_record",
            new_callable=AsyncMock,
        ) as rebuild,
        patch(
            "backend._internal.copyright.schedule_move_track_audio",
            new_callable=AsyncMock,
        ) as sched_move,
    ):
        cr_song.return_value = (
            "at://did:test:copyright-user/ch.indiemusi.alpha.song/s",
            "cid1",
        )
        cr_rec.return_value = (
            "at://did:test:copyright-user/ch.indiemusi.alpha.recording/r",
            "cid2",
        )
        await write_track_rights(sess, track, TrackRightsInput())

        # public → copyright should schedule a private move
        sched_move.assert_awaited_once()
        assert sched_move.await_args.kwargs.get("to_private") is True or (
            sched_move.await_args.args[1] is True
        )
        # PDS fm.plyr.track record must be rebuilt
        rebuild.assert_awaited()

    # row was updated in place. capture id before expire_all so the eventual
    # comparison doesn't trigger a lazy-load on the expired ORM object.
    track_id = track.id
    db_session.expire_all()
    refreshed = (
        await db_session.execute(select(Track).where(Track.id == track_id))
    ).scalar_one()
    assert refreshed.support_gate == {"type": "copyright"}
    assert refreshed.copyright_song_uri is not None
    assert refreshed.r2_url is None  # cached public URL cleared


async def test_p1_1_already_private_track_does_not_schedule_move(
    _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """uploads that landed private to begin with don't need an audio migration."""
    track = await _insert_track(
        db_session,
        _user_with_paradigm,
        support_gate=None,
        r2_url=None,  # never had a public URL
    )
    sess = _fake_session(_user_with_paradigm)

    with (
        patch(
            "backend._internal.copyright.create_song_record",
            new_callable=AsyncMock,
        ) as cr_song,
        patch(
            "backend._internal.copyright.create_recording_record",
            new_callable=AsyncMock,
        ) as cr_rec,
        patch(
            "backend._internal.copyright.rebuild_track_pds_record",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.copyright.schedule_move_track_audio",
            new_callable=AsyncMock,
        ) as sched_move,
    ):
        cr_song.return_value = ("at://x/ch.indiemusi.alpha.song/s", "c1")
        cr_rec.return_value = ("at://x/ch.indiemusi.alpha.recording/r", "c2")
        await write_track_rights(sess, track, TrackRightsInput())
        sched_move.assert_not_called()


async def test_p1_1_clear_track_rights_moves_audio_then_rebuilds_pds(
    _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """clearing copyright must move audio public synchronously THEN rebuild PDS.

    the ordering matters: rebuild_track_pds_record needs r2_url set on the row,
    which only happens after move_track_audio commits. doing the move async
    (as we used to) left the PDS record stale with the old copyright audioUrl
    indefinitely.
    """
    track = await _insert_track(
        db_session,
        _user_with_paradigm,
        support_gate={"type": "copyright"},
        r2_url=None,
        copyright_song_uri="at://did:test:copyright-user/ch.indiemusi.alpha.song/s",
    )
    track.copyright_recording_uri = (
        "at://did:test:copyright-user/ch.indiemusi.alpha.recording/r"
    )
    await db_session.commit()
    track_id = track.id
    sess = _fake_session(_user_with_paradigm)

    call_order: list[str] = []

    async def fake_move(track_id_: int, to_private: bool) -> None:
        # simulate what move_track_audio commits: r2_url repopulated on the row
        from sqlalchemy import update as _update

        call_order.append(f"move(to_private={to_private})")
        await db_session.execute(
            _update(Track)
            .where(Track.id == track_id_)
            .values(r2_url="https://audio.example.com/abc.mp3")
        )
        await db_session.commit()

    async def fake_rebuild(track_: Track, _session) -> None:
        call_order.append(
            f"rebuild(r2_url={track_.r2_url}, gate={track_.support_gate})"
        )

    with (
        patch(
            "backend._internal.copyright.delete_record_by_uri",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.copyright.rebuild_track_pds_record",
            side_effect=fake_rebuild,
        ),
        patch(
            "backend._internal.copyright.move_track_audio",
            side_effect=fake_move,
        ),
    ):
        await clear_track_rights(sess, track)

    # move must have fired before rebuild, with to_private=False
    assert call_order[0].startswith("move(to_private=False")
    # rebuild must see the freshly-populated r2_url AND the cleared gate
    assert (
        "rebuild(r2_url=https://audio.example.com/abc.mp3, gate=None)" in call_order[1]
    )

    db_session.expire_all()
    refreshed = (
        await db_session.execute(select(Track).where(Track.id == track_id))
    ).scalar_one()
    assert refreshed.support_gate is None
    assert refreshed.copyright_song_uri is None
    assert refreshed.copyright_recording_uri is None


async def test_p1_1_write_rolls_back_on_pds_rebuild_failure(
    _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """if rebuild_track_pds_record fails for a public→copyright transition, the
    local gate state must NOT be committed — otherwise the PDS record keeps
    pointing at the public R2 URL while local state says gated, leaving a
    bypassable security gap.
    """
    track = await _insert_track(
        db_session,
        _user_with_paradigm,
        support_gate=None,
        r2_url="https://audio.example.com/abc.mp3",
    )
    track_id = track.id
    sess = _fake_session(_user_with_paradigm)

    with (
        patch(
            "backend._internal.copyright.create_song_record",
            new_callable=AsyncMock,
        ) as cr_song,
        patch(
            "backend._internal.copyright.create_recording_record",
            new_callable=AsyncMock,
        ) as cr_rec,
        patch(
            "backend._internal.copyright.rebuild_track_pds_record",
            new_callable=AsyncMock,
            side_effect=RuntimeError("PDS rebuild boom"),
        ),
        patch(
            "backend._internal.copyright.schedule_move_track_audio",
            new_callable=AsyncMock,
        ) as sched_move,
    ):
        cr_song.return_value = (
            "at://did:test:copyright-user/ch.indiemusi.alpha.song/s",
            "cid1",
        )
        cr_rec.return_value = (
            "at://did:test:copyright-user/ch.indiemusi.alpha.recording/r",
            "cid2",
        )
        with pytest.raises(RuntimeError, match="PDS rebuild boom"):
            await write_track_rights(sess, track, TrackRightsInput())

        # the move must NOT have been scheduled — we never got past the rebuild
        sched_move.assert_not_called()

    db_session.expire_all()
    refreshed = (
        await db_session.execute(select(Track).where(Track.id == track_id))
    ).scalar_one()
    # phase A's URI write committed (idempotent retry shape); but the gate
    # transition and r2_url null must have rolled back
    assert refreshed.support_gate is None
    assert refreshed.r2_url == "https://audio.example.com/abc.mp3"
    assert refreshed.copyright_song_uri == (
        "at://did:test:copyright-user/ch.indiemusi.alpha.song/s"
    )


# --- P1.2: disconnect blocked by copyright-gated tracks ----------------------


@pytest.fixture
def auth_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def mock_require_auth() -> Session:
        return _fake_session()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


async def test_p1_2_disconnect_409_when_copyright_tracks_exist(
    auth_app: FastAPI, _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    await _insert_track(
        db_session,
        _user_with_paradigm,
        title="rights-bearing track",
        support_gate={"type": "copyright"},
        r2_url=None,
        copyright_song_uri="at://x/ch.indiemusi.alpha.song/s",
    )

    async with AsyncClient(
        transport=ASGITransport(app=auth_app), base_url="http://test"
    ) as client:
        response = await client.post("/copyright/disconnect")

    assert response.status_code == 409
    body = response.json()
    blocked = body["detail"]["blocked_by_tracks"]
    assert len(blocked) == 1
    assert blocked[0]["title"] == "rights-bearing track"

    # config row must still exist (disconnect was refused)
    cfg = (
        await db_session.execute(
            select(UserCopyrightConfig).where(
                UserCopyrightConfig.user_did == _user_with_paradigm
            )
        )
    ).scalar_one_or_none()
    assert cfg is not None


async def test_p1_2_disconnect_proceeds_when_no_copyright_tracks(
    auth_app: FastAPI, _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    # no tracks with copyright_song_uri set
    with patch(
        "backend.api.copyright.delete_record_by_uri",
        new_callable=AsyncMock,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=auth_app), base_url="http://test"
        ) as client:
            response = await client.post("/copyright/disconnect")

    assert response.status_code == 200
    assert response.json() == {"deleted": True}


# --- P2.2: supporter probe skips copyright-typed gates -----------------------


def test_p2_2_listing_filter_skips_copyright_gate() -> None:
    """the inline filter pattern in listing.py / for_you.py must drop copyright."""
    # exact filter from listing.py:202-207
    viewer_did = "did:test:viewer"
    tracks = [
        SimpleNamespace(artist_did="did:test:art1", support_gate={"type": "any"}),
        SimpleNamespace(artist_did="did:test:art2", support_gate={"type": "copyright"}),
        SimpleNamespace(artist_did="did:test:art3", support_gate=None),
    ]
    gated_artist_dids = {
        t.artist_did
        for t in tracks
        if t.support_gate
        and t.artist_did != viewer_did
        and (
            not isinstance(t.support_gate, dict)
            or t.support_gate.get("type") != "copyright"
        )
    }
    assert gated_artist_dids == {"did:test:art1"}


async def test_p2_2_listing_skips_supporter_probe_for_copyright(
    auth_app: FastAPI, _user_with_paradigm: str, db_session: AsyncSession
) -> None:
    """integration check: /tracks listing must not call get_supported_artists
    for tracks whose only gate is copyright-typed."""
    # seed a copyright-gated track owned by a different DID so viewer != artist
    other_did = "did:test:other-artist"
    db_session.add(
        Artist(did=other_did, handle="other.bsky.social", display_name="Other")
    )
    await db_session.commit()
    await _insert_track(
        db_session,
        other_did,
        title="copyright track",
        support_gate={"type": "copyright"},
        r2_url=None,
        copyright_song_uri="at://x/ch.indiemusi.alpha.song/s",
    )

    with patch(
        "backend.api.tracks.listing.get_supported_artists",
        new_callable=AsyncMock,
    ) as mock_probe:
        mock_probe.return_value = set()
        async with AsyncClient(
            transport=ASGITransport(app=auth_app), base_url="http://test"
        ) as client:
            response = await client.get("/tracks/")
        assert response.status_code == 200
        mock_probe.assert_not_called()
