"""copyright paradigm config — read/write helpers + callback completion.

a copyright paradigm captures rights metadata in a domain-specific shape (the
first one is indiemusi.ch alpha). users opt in once, granting plyr.fm scopes
to write paradigm-specific records to their PDS alongside fm.plyr.track.
"""

import logging
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from backend._internal import Session as AuthSession
from backend._internal.atproto.records.ch_indiemusi import (
    InterestedPartyInput,
    MasterOwnerInput,
    PublishingOwnerInput,
    RecordingArtistInput,
    RecordingInput,
    SongInput,
    create_publishing_owner_record,
    create_recording_record,
    create_song_record,
    update_recording_record,
    update_song_record,
)
from backend._internal.atproto.records.fm_plyr.track import delete_record_by_uri
from backend.config import settings
from backend.models import Artist, Track, UserCopyrightConfig
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


# --- input shapes used by the rights endpoints -----------------------------


class TrackRightsInput(BaseModel):
    """rights metadata for a track in the indiemusi paradigm.

    the primary interestedParty (the user) is derived from their
    user_copyright_configs.paradigm_data — callers don't supply it. ISWC, ISRC,
    masterOwner, and any additional co-writers/publishers are user-supplied.
    """

    model_config = ConfigDict(extra="forbid")

    iswc: str | None = Field(default=None, max_length=13)
    isrc: str | None = Field(default=None, max_length=12)
    master_owner: MasterOwnerInput | None = Field(default=None, alias="masterOwner")
    additional_interested_parties: list[InterestedPartyInput] = Field(
        default_factory=list,
        alias="additionalInterestedParties",
        description="Co-writers, composers, or publishers beyond the user. The user "
        "is auto-included as the primary interestedParty.",
    )


@dataclass
class TrackRightsResult:
    """outcome of writing rights metadata for a track."""

    song_uri: str
    recording_uri: str


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


# --- per-track rights writers ------------------------------------------------


def _interested_party_for_user(
    paradigm_data: dict[str, Any],
    user_did: str,
    user_name: str,
    additional_parties: list[InterestedPartyInput],
) -> InterestedPartyInput:
    """build the user's own interestedParty entry from their cached publishingOwner.

    mechanical/performance percentages default to the remainder after summing
    the additional parties' splits — callers can override by including the user
    in additional_parties instead.
    """
    additional_mech = sum(
        p.mechanical_royalties_percentage or 0 for p in additional_parties
    )
    additional_perf = sum(
        p.performance_royalties_percentage or 0 for p in additional_parties
    )
    return InterestedPartyInput(
        did=user_did,
        ipi=paradigm_data.get("ipi"),
        name=user_name,
        role="author, composer",
        publishingOwner=PublishingOwnerInput.model_validate(paradigm_data),
        collectingSociety=paradigm_data.get("collectingSociety"),
        mechanicalRoyaltiesPercentage=max(0, 10000 - additional_mech),
        performanceRoyaltiesPercentage=max(0, 10000 - additional_perf),
    )


async def write_track_rights(
    auth_session: AuthSession,
    track: Track,
    rights: TrackRightsInput,
) -> TrackRightsResult:
    """write (or update) indiemusi song + recording records for a track.

    creates a new pair on first call, idempotently updates the same rkeys on
    subsequent calls. updates the track row with the resulting AT-URIs and
    flips support_gate to {"type": "copyright"} so the audio endpoint requires
    auth and the file lives in private storage going forward.
    """
    cfg = await get_user_copyright_config(auth_session.did)
    if not cfg or cfg.paradigm != settings.indiemusi.paradigm_id:
        raise ValueError("user has not configured the indiemusi copyright paradigm")
    if not cfg.paradigm_data:
        raise ValueError(
            "user copyright config is missing publishingOwner data; re-run portal setup"
        )

    async with db_session() as db:
        artist = (
            await db.execute(select(Artist).where(Artist.did == auth_session.did))
        ).scalar_one_or_none()
    if not artist:
        raise ValueError("artist row not found for user")

    primary_party = _interested_party_for_user(
        paradigm_data=cfg.paradigm_data,
        user_did=auth_session.did,
        user_name=artist.display_name,
        additional_parties=rights.additional_interested_parties,
    )
    interested_parties = [primary_party, *rights.additional_interested_parties]

    song_input = SongInput(
        title=track.title,
        iswc=rights.iswc,
        interestedParties=interested_parties,
    )
    recording_input = RecordingInput(
        title=track.title,
        artists=[RecordingArtistInput(name=artist.display_name, did=auth_session.did)],
        isrc=rights.isrc,
        duration=track.duration,
        masterOwner=rights.master_owner,
        song=None,  # song lives at its own URI; don't duplicate inline
    )

    if track.copyright_song_uri:
        song_uri, _ = await update_song_record(
            auth_session, track.copyright_song_uri, song_input
        )
    else:
        song_uri, _ = await create_song_record(auth_session, song_input)

    if track.copyright_recording_uri:
        recording_uri, _ = await update_recording_record(
            auth_session, track.copyright_recording_uri, recording_input
        )
    else:
        recording_uri, _ = await create_recording_record(auth_session, recording_input)

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track.id))
        row = result.scalar_one()
        row.copyright_song_uri = song_uri
        row.copyright_recording_uri = recording_uri
        if row.support_gate is None:
            row.support_gate = {"type": "copyright"}
        await db.commit()

    logger.info(
        "wrote indiemusi rights for track %s (song=%s recording=%s)",
        track.id,
        song_uri,
        recording_uri,
    )
    return TrackRightsResult(song_uri=song_uri, recording_uri=recording_uri)


async def clear_track_rights(
    auth_session: AuthSession,
    track: Track,
) -> None:
    """delete indiemusi rights records for a track and clear the URI columns.

    best-effort PDS deletes — local state is cleared regardless. support_gate
    is cleared only when it was set to {"type": "copyright"} (don't clobber
    supporter-gating that was unrelated to rights).
    """
    for uri in (track.copyright_song_uri, track.copyright_recording_uri):
        if not uri:
            continue
        try:
            await delete_record_by_uri(auth_session, uri)
        except Exception as e:
            logger.warning("failed to delete %s: %s", uri, e)

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track.id))
        row = result.scalar_one()
        row.copyright_song_uri = None
        row.copyright_recording_uri = None
        if (
            isinstance(row.support_gate, dict)
            and row.support_gate.get("type") == "copyright"
        ):
            row.support_gate = None
        await db.commit()
