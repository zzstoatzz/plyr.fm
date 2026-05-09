"""space CRUD + access checks, mirroring ``com.atproto.space.*`` XRPC shape.

today: backed by postgres tables (``spaces``, ``space_members``, ``space_records``).
tomorrow: implementation calls ``com.atproto.space.*`` on the user's PDS,
verifying SpaceCredential JWTs. the public interface here doesn't change.
"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.spaces.nsids import PERSONAL_SPACE_TYPE
from backend._internal.spaces.uri import build_space_uri
from backend.models.space import Space, SpaceMember, SpaceRecord


async def get_or_create_personal_space(
    db: AsyncSession,
    owner_did: str,
    skey: str,
) -> Space:
    """return the user's personal space for a given skey, creating it if absent.

    the personal space type (``fm.plyr.personal``) is the OAuth consent
    boundary for a user's private app data. ``skey`` distinguishes multiple
    personal spaces under the same owner — e.g. ``"playlists"``, ``"drafts"``.

    on creation the owner is added as the sole member.
    """
    uri = build_space_uri(owner_did, PERSONAL_SPACE_TYPE, skey)

    existing = (
        await db.execute(select(Space).where(Space.uri == uri))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    space = Space(uri=uri, owner_did=owner_did, type=PERSONAL_SPACE_TYPE, skey=skey)
    db.add(space)
    await db.flush()
    await add_member(db, uri, owner_did)
    return space


async def add_member(db: AsyncSession, space_uri: str, did: str) -> None:
    """add a DID to a space's member list. idempotent."""
    stmt = (
        pg_insert(SpaceMember)
        .values(space_uri=space_uri, did=did)
        .on_conflict_do_nothing(index_elements=["space_uri", "did"])
    )
    await db.execute(stmt)


async def is_member(db: AsyncSession, space_uri: str, did: str) -> bool:
    """check whether a DID is on a space's member list."""
    result = await db.execute(
        select(SpaceMember.did).where(
            SpaceMember.space_uri == space_uri,
            SpaceMember.did == did,
        )
    )
    return result.scalar_one_or_none() is not None


async def can_read(
    db: AsyncSession,
    viewer_did: str | None,
    space_uri: str,
) -> bool:
    """access gate for permissioned content.

    today: queries the local member list.
    tomorrow: verifies a SpaceCredential JWT against the space owner's DID doc.
    callers shouldn't care which.
    """
    if viewer_did is None:
        return False
    return await is_member(db, space_uri, viewer_did)


async def create_record(
    db: AsyncSession,
    space_uri: str,
    writer_did: str,
    collection: str,
    rkey: str,
    value: dict,
) -> SpaceRecord:
    """create a new record in a permissioned space.

    raises if a record with the same ``(space_uri, collection, rkey)`` exists.
    the unique constraint on the table enforces it; flush surfaces the error.
    """
    record = SpaceRecord(
        space_uri=space_uri,
        writer_did=writer_did,
        collection=collection,
        rkey=rkey,
        value=value,
    )
    db.add(record)
    await db.flush()
    return record


async def get_record(
    db: AsyncSession,
    space_uri: str,
    collection: str,
    rkey: str,
) -> SpaceRecord | None:
    """fetch a single record by ``(space, collection, rkey)``."""
    result = await db.execute(
        select(SpaceRecord).where(
            SpaceRecord.space_uri == space_uri,
            SpaceRecord.collection == collection,
            SpaceRecord.rkey == rkey,
        )
    )
    return result.scalar_one_or_none()


async def list_records(
    db: AsyncSession,
    space_uri: str,
    collection: str,
) -> list[SpaceRecord]:
    """list all records in a collection within a space."""
    result = await db.execute(
        select(SpaceRecord)
        .where(
            SpaceRecord.space_uri == space_uri,
            SpaceRecord.collection == collection,
        )
        .order_by(SpaceRecord.created_at.asc())
    )
    return list(result.scalars().all())


async def update_record(
    db: AsyncSession,
    space_uri: str,
    collection: str,
    rkey: str,
    value: dict,
) -> SpaceRecord | None:
    """replace a record's value; returns the updated row or None if missing."""
    record = await get_record(db, space_uri, collection, rkey)
    if record is None:
        return None
    record.value = value
    await db.flush()
    return record


async def delete_record(
    db: AsyncSession,
    space_uri: str,
    collection: str,
    rkey: str,
) -> bool:
    """delete a record; returns True if it existed."""
    record = await get_record(db, space_uri, collection, rkey)
    if record is None:
        return False
    await db.delete(record)
    await db.flush()
    return True
