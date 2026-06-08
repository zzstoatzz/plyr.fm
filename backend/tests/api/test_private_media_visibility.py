"""private (permissioned-space) media must not leak through public surfaces (#1528).

private tracks set is_private=True (and unlisted=True). they must be excluded from
public search and from an artist page viewed by anyone but the owner, and must
serialize without tripping over their ats:// record URI.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session
from backend.api.search import _search_tracks
from backend.api.tracks.listing import list_tracks
from backend.models import Artist, Track
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
        is_private=private,
        unlisted=private,
        space_uri=(f"ats://{_DID}/fm.plyr.privateMedia/self" if private else None),
        atproto_record_uri=(
            f"ats://{_DID}/fm.plyr.privateMedia/self/{_DID}/fm.plyr.track/rk"
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
    # passing a pds_url used to push the ats:// URI through parse_at_uri and raise
    resp = await TrackResponse.from_track(track, pds_url="https://test.pds")
    assert resp.atproto_record_url is None
