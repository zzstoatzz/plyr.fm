"""Tests for the canonical-URI application-policy boundary."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.track_policy import (
    replace_track_moderation_policies,
    upsert_track_access_policy,
)
from backend.models import TrackPolicy


async def test_access_upsert_is_keyed_by_portable_record_uri(
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
            select(TrackPolicy).where(TrackPolicy.record_uri == uri)
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].visibility == "unlisted"
    assert rows[0].access_write_source == "local_command"
    assert rows[0].access_observed_at_us is not None
    assert rows[0].access_observed_at_us > 0
    assert rows[0].operator_labels == []


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


async def test_moderation_replacement_preserves_access_and_removes_empty_rows(
    db_session: AsyncSession,
) -> None:
    access_uri = "at://did:plc:policy/fm.plyr.track/access"
    moderation_uri = "at://did:plc:policy/fm.plyr.track/moderated"
    await upsert_track_access_policy(
        db_session,
        record_uri=access_uri,
        visibility="public",
        space_uri=None,
    )
    await replace_track_moderation_policies(
        db_session,
        {
            access_uri: (["sexual"], None),
            moderation_uri: (["copyright-violation"], "exclude"),
        },
    )
    await db_session.commit()

    rows = {
        policy.record_uri: policy
        for policy in (await db_session.scalars(select(TrackPolicy))).all()
    }
    assert rows[access_uri].visibility == "public"
    assert rows[access_uri].operator_labels == ["sexual"]
    assert rows[moderation_uri].visibility is None
    assert rows[moderation_uri].moderation_decision == "exclude"

    await replace_track_moderation_policies(db_session, {})
    await db_session.commit()
    db_session.expire_all()

    remaining = (await db_session.scalars(select(TrackPolicy))).all()
    assert [policy.record_uri for policy in remaining] == [access_uri]
    assert remaining[0].operator_labels == []
    assert remaining[0].moderation_write_source is None
