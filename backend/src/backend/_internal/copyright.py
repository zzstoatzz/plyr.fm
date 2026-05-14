"""copyright paradigm config — read/write helpers + callback completion.

a copyright paradigm captures rights metadata in a domain-specific shape (the
first one is indiemusi.ch alpha). users opt in once, granting plyr.fm scopes
to write paradigm-specific records to their PDS alongside fm.plyr.track.
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from backend._internal import Session as AuthSession
from backend._internal.atproto.records.ch_indiemusi import (
    PublishingOwnerInput,
    create_publishing_owner_record,
)
from backend.config import settings
from backend.models import UserCopyrightConfig
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def get_user_copyright_config(did: str) -> UserCopyrightConfig | None:
    async with db_session() as db:
        result = await db.execute(
            select(UserCopyrightConfig).where(UserCopyrightConfig.user_did == did)
        )
        return result.scalar_one_or_none()


async def upsert_user_copyright_config(
    did: str,
    paradigm: str,
    config_uri: str | None,
    paradigm_data: dict[str, Any] | None,
) -> None:
    """upsert a user_copyright_configs row keyed by user_did."""
    async with db_session() as db:
        stmt = (
            insert(UserCopyrightConfig)
            .values(
                user_did=did,
                paradigm=paradigm,
                config_uri=config_uri,
                paradigm_data=paradigm_data,
            )
            .on_conflict_do_update(
                index_elements=[UserCopyrightConfig.user_did],
                set_={
                    "paradigm": paradigm,
                    "config_uri": config_uri,
                    "paradigm_data": paradigm_data,
                },
            )
        )
        await db.execute(stmt)
        await db.commit()


async def delete_user_copyright_config(did: str) -> None:
    async with db_session() as db:
        result = await db.execute(
            select(UserCopyrightConfig).where(UserCopyrightConfig.user_did == did)
        )
        if row := result.scalar_one_or_none():
            await db.delete(row)
            await db.commit()


async def complete_indiemusi_setup(
    auth_session: AuthSession, paradigm_data: dict[str, Any]
) -> None:
    """callback-side completion for the indiemusi paradigm.

    runs after the new (upgraded) session has indiemusi scopes. writes the
    publishingOwner record to the user's PDS and saves the config row pointing
    at it. paradigm_data is the validated PublishingOwnerInput as a dict
    (model_dump(by_alias=True)).
    """
    owner = PublishingOwnerInput.model_validate(paradigm_data)
    uri, _cid = await create_publishing_owner_record(auth_session, owner)
    await upsert_user_copyright_config(
        did=auth_session.did,
        paradigm=settings.indiemusi.paradigm_id,
        config_uri=uri,
        paradigm_data=owner.model_dump(by_alias=True, exclude_none=True),
    )
    logger.info(
        "completed indiemusi setup for %s (publishingOwner=%s)",
        auth_session.did,
        uri,
    )
