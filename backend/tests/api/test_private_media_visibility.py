"""private (permissioned-space) media must not leak through public surfaces (#1528).

private tracks set is_private=True (and unlisted=True). they must be excluded from
public search and from an artist page viewed by anyone but the owner, and must
serialize without treating their permissioned at:// URI as a public record.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session
from backend.api.search import _search_tracks
from backend.api.tracks.listing import list_tracks
from backend.models import Artist, PrivateMediaMember, Track
from backend.schemas import TrackResponse

_DID = "did:test:private-vis"


def _session(did: str) -> Session:
    s = Session.__new__(Session)
    s.did = did
    s.handle = "owner.test"
    s.session_id = "sess"
    s.oauth_session = {"did": did, "pds_url": "https://test.pds"}
    return s


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    artist = Artist(did=_DID, handle="privvis.test", display_name="Priv Vis")
    db_session.add(artist)
    await db_session.commit()
    return artist


async def _make_track(db_session: AsyncSession, *, title: str, fid: str, private: bool):
    track = Track(
        title=title,
        artist_did=_DID,
        file_id=fid,
        file_type="mp3",
        visibility="private" if private else "public",
        space_uri=(f"at://{_DID}/space/fm.plyr.privateMedia/self" if private else None),
        atproto_record_uri=(
            f"at://{_DID}/space/fm.plyr.privateMedia/self/{_DID}/fm.plyr.track/rk"
            if private
            else f"at://{_DID}/fm.plyr.track/rk"
        ),
    )
    db_session.add(track)
    await db_session.commit()
    return track


async def test_search_excludes_private(db_session: AsyncSession, artist: Artist):
    await _make_track(db_session, title="ztitle public", fid="pv_pub", private=False)
    await _make_track(db_session, title="ztitle private", fid="pv_priv", private=True)

    results = await _search_tracks(db_session, "ztitle", 20)
    titles = {r.title for r in results}
    assert "ztitle public" in titles
    assert "ztitle private" not in titles


async def test_artist_page_hides_private_from_non_owner(
    db_session: AsyncSession, artist: Artist
):
    await _make_track(db_session, title="ypublic", fid="ap_pub", private=False)
    await _make_track(db_session, title="yprivate", fid="ap_priv", private=True)

    # anonymous / other viewer: private excluded
    anon = await list_tracks(db_session, artist_did=_DID, session=None)
    assert "yprivate" not in {t.title for t in anon.tracks}
    assert "ypublic" in {t.title for t in anon.tracks}

    other = await list_tracks(
        db_session, artist_did=_DID, session=_session("did:test:someone-else")
    )
    assert "yprivate" not in {t.title for t in other.tracks}

    # owner sees their own private track
    owner = await list_tracks(db_session, artist_did=_DID, session=_session(_DID))
    assert "yprivate" in {t.title for t in owner.tracks}


async def test_private_track_serializes_without_at_uri_crash(
    db_session: AsyncSession, artist: Artist
):
    await _make_track(db_session, title="serial", fid="ser_priv", private=True)
    # reload with relationships the way the real list/serialize paths do
    track = (
        await db_session.execute(
            select(Track)
            .options(selectinload(Track.artist), selectinload(Track.album_rel))
            .where(Track.file_id == "ser_priv")
        )
    ).scalar_one()
    # A PDS URL must not turn a permissioned URI into a public record endpoint.
    resp = await TrackResponse.from_track(track, pds_url="https://test.pds")
    assert resp.atproto_record_url is None
    assert resp.r2_url is None


async def test_adult_track_serializes_through_policy_endpoint(
    db_session: AsyncSession, artist: Artist
):
    track = await _make_track(
        db_session, title="adult", fid="adult_public", private=False
    )
    track.r2_url = "https://cdn.example.com/audio/adult.mp3"
    await db_session.commit()
    track = (
        await db_session.execute(
            select(Track)
            .options(selectinload(Track.artist), selectinload(Track.album_rel))
            .where(Track.file_id == "adult_public")
        )
    ).scalar_one()

    resp = await TrackResponse.from_track(track, content_labels={track.id: {"sexual"}})

    assert resp.r2_url is not None
    assert resp.r2_url.endswith("/audio/adult_public")
    assert "cdn.example.com" not in resp.r2_url


# --- centralized helper (the chokepoint every endpoint routes through) --------


async def test_visibility_helper_rules(db_session: AsyncSession, artist: Artist):
    from fastapi import HTTPException

    from backend._internal.track_visibility import can_view_track, ensure_track_visible

    public = await _make_track(db_session, title="p", fid="h_pub", private=False)
    private = await _make_track(db_session, title="x", fid="h_priv", private=True)
    db_session.add(PrivateMediaMember(artist_did=_DID, member_did="did:test:member"))
    await db_session.commit()

    # public: anyone
    assert await can_view_track(db_session, None, public)
    assert await can_view_track(db_session, "did:test:other", public)
    # private: owner and members
    assert await can_view_track(db_session, _DID, private)
    assert await can_view_track(db_session, "did:test:member", private)
    assert not await can_view_track(db_session, None, private)
    assert not await can_view_track(db_session, "did:test:other", private)

    await ensure_track_visible(db_session, private, _DID)
    await ensure_track_visible(db_session, private, "did:test:member")
    for did in (None, "did:test:other"):
        with pytest.raises(HTTPException) as exc:
            await ensure_track_visible(db_session, private, did)
        assert exc.value.status_code == 404


async def test_member_sees_private_in_artist_listing(
    db_session: AsyncSession, artist: Artist
):
    await _make_track(db_session, title="for members", fid="m_priv", private=True)
    db_session.add(PrivateMediaMember(artist_did=_DID, member_did="did:test:member"))
    await db_session.commit()

    async def titles(session: Session | None) -> list[str]:
        page = await list_tracks(
            db=db_session, session=session, artist_did=_DID, limit=50
        )
        return [t.title for t in page.tracks]

    assert "for members" in await titles(_session("did:test:member"))
    assert "for members" not in await titles(_session("did:test:other"))
    assert "for members" not in await titles(None)


# --- endpoint proof: GET /tracks/{id} is the headline leak --------------------


async def test_track_detail_endpoint_owner_only_for_private(
    db_session: AsyncSession, artist: Artist
):
    from fastapi.testclient import TestClient

    from backend._internal import get_optional_session
    from backend.main import app

    track = await _make_track(db_session, title="detail", fid="det_priv", private=True)

    async def _anon() -> Session | None:
        return None

    async def _owner() -> Session | None:
        return _session(_DID)

    app.dependency_overrides[get_optional_session] = _anon
    try:
        with TestClient(app) as client:
            assert client.get(f"/tracks/{track.id}").status_code == 404
        app.dependency_overrides[get_optional_session] = _owner
        with TestClient(app) as client:
            assert client.get(f"/tracks/{track.id}").status_code == 200

        db_session.add(
            PrivateMediaMember(artist_did=_DID, member_did="did:test:member")
        )
        await db_session.commit()

        async def _member() -> Session | None:
            return _session("did:test:member")

        async def _stranger() -> Session | None:
            return _session("did:test:other")

        app.dependency_overrides[get_optional_session] = _member
        with TestClient(app) as client:
            assert client.get(f"/tracks/{track.id}").status_code == 200
        app.dependency_overrides[get_optional_session] = _stranger
        with TestClient(app) as client:
            assert client.get(f"/tracks/{track.id}").status_code == 404
    finally:
        app.dependency_overrides.clear()


async def test_audio_url_for_private_track_owner_and_members_only(
    db_session: AsyncSession, artist: Artist
):
    """/audio/{id}/url is the cacheable handle the player asks for first; it must
    answer the owner and members with the proxy URL and everyone else with 404."""
    from fastapi.testclient import TestClient

    from backend._internal import get_optional_session
    from backend.main import app

    track = await _make_track(db_session, title="hear", fid="aud_priv", private=True)
    db_session.add(PrivateMediaMember(artist_did=_DID, member_did="did:test:member"))
    await db_session.commit()

    async def statuses(session: Session | None) -> int:
        async def dep() -> Session | None:
            return session

        app.dependency_overrides[get_optional_session] = dep
        with TestClient(app) as client:
            return client.get(f"/audio/{track.file_id}/url").status_code

    try:
        assert await statuses(_session(_DID)) == 200
        assert await statuses(_session("did:test:member")) == 200
        assert await statuses(_session("did:test:other")) == 404
        assert await statuses(None) == 404
    finally:
        app.dependency_overrides.clear()
