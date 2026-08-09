"""Tests for the application-owned track access-policy boundary."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.track_access_policy import upsert_track_access_policy
from backend.models import TrackAccessPolicy


async def test_upsert_is_keyed_by_portable_record_uri(
    db_session: AsyncSession,
) -> None:
    uri = "at://did:plc:policy/fm.plyr.track/one"
    await upsert_track_access_policy(
        db_session,
        record_uri=uri,
        visibility="public",
        space_uri=None,
    )
    await db_session.commit()

    await upsert_track_access_policy(
        db_session,
        record_uri=uri,
        visibility="unlisted",
        space_uri=None,
    )
    await db_session.commit()

    rows = (
        await db_session.scalars(
            select(TrackAccessPolicy).where(TrackAccessPolicy.record_uri == uri)
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].visibility == "unlisted"
    assert rows[0].write_source == "local_command"
    assert rows[0].observed_at_us > 0


async def test_private_policy_requires_a_permissioned_space(
    db_session: AsyncSession,
) -> None:
    with pytest.raises(IntegrityError):
        await upsert_track_access_policy(
            db_session,
            record_uri="at://did:plc:policy/fm.plyr.track/private",
            visibility="private",
            space_uri=None,
        )
