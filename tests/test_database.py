"""test database setup and basic operations."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from relay.models import Artist


async def test_database_connection(db_session: AsyncSession):
    """verify database connection works."""
    result = await db_session.execute(select(1))
    assert result.scalar() == 1


async def test_create_artist(db_session: AsyncSession):
    """verify we can create an artist record."""
    artist = Artist(
        did="did:plc:test123",
        handle="test.bsky.social",
        display_name="test artist",
        bio="test bio",
        avatar_url="https://example.com/avatar.jpg",
    )

    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)

    # verify the artist was created
    assert artist.did == "did:plc:test123"
    assert artist.handle == "test.bsky.social"
    assert artist.display_name == "test artist"


async def test_query_artist(db_session: AsyncSession):
    """verify we can query artists."""
    # create an artist
    artist = Artist(
        did="did:plc:query123",
        handle="query.bsky.social",
        display_name="query test",
    )
    db_session.add(artist)
    await db_session.commit()

    # query it back
    result = await db_session.execute(
        select(Artist).where(Artist.did == "did:plc:query123")
    )
    queried_artist = result.scalar_one_or_none()

    assert queried_artist is not None
    assert queried_artist.handle == "query.bsky.social"
    assert queried_artist.display_name == "query test"


async def test_database_isolation(db_session: AsyncSession):
    """verify tests are isolated - this should not see artists from other tests."""
    result = await db_session.execute(select(Artist))
    artists = result.scalars().all()

    # if isolation works, we should have no artists from previous tests
    assert len(artists) == 0
