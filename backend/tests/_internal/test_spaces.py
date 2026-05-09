"""tests for the permissioned-data spaces abstraction."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.spaces import (
    PERSONAL_SPACE_TYPE,
    PLAYLIST_COLLECTION,
    add_member,
    build_space_uri,
    can_read,
    create_record,
    delete_record,
    get_or_create_personal_space,
    get_record,
    is_member,
    list_records,
    parse_space_uri,
    update_record,
)
from backend.models import Artist, Space, SpaceMember, SpaceRecord


@pytest.fixture
async def owner(db_session: AsyncSession) -> Artist:
    artist = Artist(
        did="did:plc:owner",
        handle="owner.test",
        display_name="Owner",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


# ---------------------------------------------------------------------------
# uri helpers
# ---------------------------------------------------------------------------


def test_build_space_uri_shape() -> None:
    uri = build_space_uri("did:plc:abc", "fm.plyr.personal", "playlists")
    assert uri == "plyr-space://did:plc:abc/fm.plyr.personal/playlists"


def test_parse_space_uri_roundtrip() -> None:
    components = ("did:plc:abc", "fm.plyr.personal", "playlists")
    assert parse_space_uri(build_space_uri(*components)) == components


def test_parse_space_uri_rejects_at_scheme() -> None:
    with pytest.raises(ValueError):
        parse_space_uri("at://did:plc:abc/fm.plyr.list/abc")


# ---------------------------------------------------------------------------
# get_or_create_personal_space
# ---------------------------------------------------------------------------


async def test_personal_space_creates_with_owner_as_member(
    db_session: AsyncSession, owner: Artist
) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await db_session.commit()

    assert space.type == PERSONAL_SPACE_TYPE
    assert space.skey == "playlists"
    assert space.owner_did == owner.did
    assert await is_member(db_session, space.uri, owner.did) is True


async def test_personal_space_idempotent(
    db_session: AsyncSession, owner: Artist
) -> None:
    a = await get_or_create_personal_space(db_session, owner.did, "playlists")
    b = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await db_session.commit()
    assert a.uri == b.uri

    rows = (
        (await db_session.execute(select(Space).where(Space.uri == a.uri)))
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_personal_space_skeys_distinct(
    db_session: AsyncSession, owner: Artist
) -> None:
    playlists = await get_or_create_personal_space(db_session, owner.did, "playlists")
    drafts = await get_or_create_personal_space(db_session, owner.did, "drafts")
    await db_session.commit()
    assert playlists.uri != drafts.uri


# ---------------------------------------------------------------------------
# add_member / is_member / can_read
# ---------------------------------------------------------------------------


async def test_add_member_idempotent(db_session: AsyncSession, owner: Artist) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await add_member(db_session, space.uri, "did:plc:other")
    await add_member(db_session, space.uri, "did:plc:other")
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(SpaceMember).where(
                    SpaceMember.space_uri == space.uri,
                    SpaceMember.did == "did:plc:other",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1


async def test_can_read_owner_yes_other_no(
    db_session: AsyncSession, owner: Artist
) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await db_session.commit()

    assert await can_read(db_session, owner.did, space.uri) is True
    assert await can_read(db_session, "did:plc:other", space.uri) is False
    assert await can_read(db_session, None, space.uri) is False


# ---------------------------------------------------------------------------
# record CRUD
# ---------------------------------------------------------------------------


async def test_create_and_get_record(db_session: AsyncSession, owner: Artist) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    rec = await create_record(
        db_session,
        space_uri=space.uri,
        writer_did=owner.did,
        collection=PLAYLIST_COLLECTION,
        rkey="abc",
        value={"name": "first", "items": []},
    )
    await db_session.commit()

    fetched = await get_record(db_session, space.uri, PLAYLIST_COLLECTION, "abc")
    assert fetched is not None
    assert fetched.id == rec.id
    assert fetched.value["name"] == "first"


async def test_update_record(db_session: AsyncSession, owner: Artist) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await create_record(
        db_session,
        space_uri=space.uri,
        writer_did=owner.did,
        collection=PLAYLIST_COLLECTION,
        rkey="abc",
        value={"name": "first", "items": []},
    )
    await update_record(
        db_session,
        space.uri,
        PLAYLIST_COLLECTION,
        "abc",
        {"name": "second", "items": [1]},
    )
    await db_session.commit()

    fetched = await get_record(db_session, space.uri, PLAYLIST_COLLECTION, "abc")
    assert fetched is not None
    assert fetched.value["name"] == "second"
    assert fetched.value["items"] == [1]


async def test_delete_record(db_session: AsyncSession, owner: Artist) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await create_record(
        db_session,
        space_uri=space.uri,
        writer_did=owner.did,
        collection=PLAYLIST_COLLECTION,
        rkey="abc",
        value={"name": "first", "items": []},
    )
    await db_session.commit()

    deleted = await delete_record(db_session, space.uri, PLAYLIST_COLLECTION, "abc")
    await db_session.commit()
    assert deleted is True
    assert await get_record(db_session, space.uri, PLAYLIST_COLLECTION, "abc") is None

    # second delete is a no-op
    assert (
        await delete_record(db_session, space.uri, PLAYLIST_COLLECTION, "abc") is False
    )


async def test_list_records_ordered_by_created_at(
    db_session: AsyncSession, owner: Artist
) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    for rkey in ("a", "b", "c"):
        await create_record(
            db_session,
            space_uri=space.uri,
            writer_did=owner.did,
            collection=PLAYLIST_COLLECTION,
            rkey=rkey,
            value={"rkey": rkey, "items": []},
        )
        await db_session.flush()
    await db_session.commit()

    records = await list_records(db_session, space.uri, PLAYLIST_COLLECTION)
    assert [r.rkey for r in records] == ["a", "b", "c"]


async def test_create_record_duplicate_rkey_raises(
    db_session: AsyncSession, owner: Artist
) -> None:
    space = await get_or_create_personal_space(db_session, owner.did, "playlists")
    await create_record(
        db_session,
        space_uri=space.uri,
        writer_did=owner.did,
        collection=PLAYLIST_COLLECTION,
        rkey="abc",
        value={"items": []},
    )
    await db_session.commit()

    with pytest.raises(IntegrityError):
        await create_record(
            db_session,
            space_uri=space.uri,
            writer_did=owner.did,
            collection=PLAYLIST_COLLECTION,
            rkey="abc",
            value={"items": []},
        )
        await db_session.commit()


async def test_space_records_table_orm_present(db_session: AsyncSession) -> None:
    """sanity: the SpaceRecord ORM is registered and queryable."""
    rows = (await db_session.execute(select(SpaceRecord).limit(1))).scalars().all()
    assert isinstance(rows, list)
