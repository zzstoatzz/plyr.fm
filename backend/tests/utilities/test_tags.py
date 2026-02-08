"""tests for shared tag operations (DB-backed)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Tag, Track, TrackTag
from backend.utilities.tags import add_tags_to_track, get_or_create_tag


async def _create_artist(db_session: AsyncSession, did: str) -> Artist:
    """helper to create an artist for FK constraints."""
    artist = Artist(did=did, handle=f"{did.split(':')[-1]}.test", display_name="Test")
    db_session.add(artist)
    await db_session.flush()
    return artist


async def test_get_or_create_tag_creates_new(db_session: AsyncSession):
    """creates tag that doesn't exist."""
    await _create_artist(db_session, "did:plc:test1")
    tag = await get_or_create_tag(db_session, "electronic", "did:plc:test1")
    assert tag.name == "electronic"
    assert tag.created_by_did == "did:plc:test1"
    assert tag.id is not None


async def test_get_or_create_tag_returns_existing(db_session: AsyncSession):
    """idempotent - returns existing tag."""
    await _create_artist(db_session, "did:plc:test2")
    tag1 = await get_or_create_tag(db_session, "ambient", "did:plc:test2")
    await db_session.commit()

    tag2 = await get_or_create_tag(db_session, "ambient", "did:plc:test3")
    assert tag2.id == tag1.id
    assert tag2.name == "ambient"


async def test_add_tags_to_track(db_session: AsyncSession):
    """associates tags with track."""
    await _create_artist(db_session, "did:plc:tagger")

    track = Track(
        title="test track",
        file_id="test_file_id_tags",
        file_type="mp3",
        artist_did="did:plc:tagger",
        atproto_record_uri="at://did:plc:tagger/fm.plyr.track/test",
        atproto_record_cid="bafytest",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    await add_tags_to_track(db_session, track.id, ["rock", "indie"], "did:plc:tagger")

    # verify tags were created and associated
    result = await db_session.execute(
        select(TrackTag).where(TrackTag.track_id == track.id)
    )
    track_tags = result.scalars().all()
    assert len(track_tags) == 2

    tag_ids = {tt.tag_id for tt in track_tags}
    result = await db_session.execute(select(Tag).where(Tag.id.in_(tag_ids)))
    tags = result.scalars().all()
    tag_names = {t.name for t in tags}
    assert tag_names == {"rock", "indie"}


async def test_add_tags_to_track_empty(db_session: AsyncSession):
    """no-op when tags list is empty."""
    # should not raise
    await add_tags_to_track(db_session, 999, [], "did:plc:test")
