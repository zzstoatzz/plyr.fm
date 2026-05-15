"""copyright paradigm config — read/write helpers + callback completion.

a copyright paradigm captures rights metadata in a domain-specific shape (the
first one is indiemusi.ch alpha). users opt in once, granting plyr.fm scopes
to write paradigm-specific records to their PDS alongside fm.plyr.track.
"""

import logging
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal.atproto.records.ch_indiemusi import (
    ISRC_PATTERN,
    ISWC_PATTERN,
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
from backend._internal.atproto.records.fm_plyr.track import (
    delete_record_by_uri,
    rebuild_track_pds_record,
)
from backend._internal.tasks.storage import (
    move_track_audio,
    schedule_move_track_audio,
)
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

    iswc: str | None = Field(default=None, max_length=13, pattern=ISWC_PATTERN)
    isrc: str | None = Field(default=None, max_length=12, pattern=ISRC_PATTERN)
    master_owner: MasterOwnerInput | None = Field(default=None, alias="masterOwner")
    additional_interested_parties: list[InterestedPartyInput] = Field(
        default_factory=list,
        alias="additionalInterestedParties",
        description="Co-writers, composers, or publishers beyond the user. The user "
        "is auto-included as the primary interestedParty.",
    )

    @model_validator(mode="after")
    def _splits_total_within_100_percent(self) -> "TrackRightsInput":
        """additional parties' royalty splits must leave room for the primary party.

        splits are basis points (10000 = 100%). the primary party (the user) is
        added at write time with the remainder; sums above 10000 would either
        clamp the primary to 0 or, worse, emit a record whose splits aggregate
        to more than 100% — neither is a valid expression of the underlying
        royalty math.
        """
        mech = sum(
            p.mechanical_royalties_percentage or 0
            for p in self.additional_interested_parties
        )
        perf = sum(
            p.performance_royalties_percentage or 0
            for p in self.additional_interested_parties
        )
        if mech > 10000:
            raise ValueError(
                f"mechanical royalty splits for additional parties total {mech} "
                f"basis points; must not exceed 10000 (100%)"
            )
        if perf > 10000:
            raise ValueError(
                f"performance royalty splits for additional parties total {perf} "
                f"basis points; must not exceed 10000 (100%)"
            )
        return self


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


def _is_copyright_gate(gate: Any) -> bool:
    """True iff `gate` is a copyright-typed support_gate dict."""
    return isinstance(gate, dict) and gate.get("type") == "copyright"


async def write_track_rights(
    auth_session: AuthSession,
    track: Track,
    rights: TrackRightsInput,
) -> TrackRightsResult:
    """write (or update) indiemusi song + recording records for a track.

    creates a new pair on first call, idempotently updates the same rkeys on
    subsequent calls. when the track wasn't already copyright-gated, this also:
    - flips support_gate to {"type": "copyright"}
    - rebuilds the fm.plyr.track PDS record so its audioUrl points at the
      auth-proxied /audio/{file_id} endpoint instead of the public R2 URL
    - clears r2_url on the row so other callers stop treating it as public
    - schedules a background move of the audio file into the private bucket

    raises ValueError when the user hasn't completed indiemusi setup or when
    the track already has a non-copyright support_gate (e.g., atprotofans
    supporter gating). gate modes are mutually exclusive.

    raises any underlying exception from rebuild_track_pds_record when the
    track is transitioning from public to copyright-gated. on failure the
    transition is rolled back so the PDS record's audioUrl never lags
    behind the local gate state (which would let third-party clients keep
    pulling audio from the cached public R2 URL).
    """
    cfg = await get_user_copyright_config(auth_session.did)
    if not cfg or cfg.paradigm != settings.indiemusi.paradigm_id:
        raise ValueError("user has not configured the indiemusi copyright paradigm")
    if not cfg.paradigm_data:
        raise ValueError(
            "user copyright config is missing publishingOwner data; re-run portal setup"
        )

    existing_gate = track.support_gate
    if existing_gate is not None and not _is_copyright_gate(existing_gate):
        raise ValueError(
            "track is already supporter-gated; copyright and supporter gating "
            "are mutually exclusive — clear the supporter gate first"
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

    # phase A: write song + recording records to PDS and persist the URIs
    # locally. these are idempotent on retry (existing rkeys → putRecord). a
    # failure between PDS write and DB commit leaves orphan PDS records, but
    # they're re-targeted (not re-created) on the retry.
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

    transitioning_to_private = existing_gate is None and track.r2_url is not None

    # commit the URI pointers FIRST so a failure during the gate transition
    # (phase B) doesn't roll back our knowledge of the PDS records we just
    # wrote. on retry, phase A then targets the existing rkeys via putRecord
    # (idempotent) instead of creating duplicate orphans.
    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track.id))
        row = result.scalar_one()
        row.copyright_song_uri = song_uri
        row.copyright_recording_uri = recording_uri
        # tracks already gated (re-edit) or never public (upload-time) can
        # flip the gate alongside the URIs — the audioUrl was already set to
        # the auth-proxied endpoint on a prior write, no rebuild needed
        if not transitioning_to_private and row.support_gate is None:
            row.support_gate = {"type": "copyright"}
        await db.commit()

    if transitioning_to_private:
        # phase B: public → copyright transition. rebuild fm.plyr.track so
        # its audioUrl flips to /audio/{file_id}, then commit the gate state.
        # raising during rebuild rolls back this phase only — the URIs
        # committed above stay, so retry uses putRecord on the same rkeys.
        async with db_session() as db:
            result = await db.execute(
                select(Track)
                .options(selectinload(Track.artist))
                .where(Track.id == track.id)
            )
            row = result.scalar_one()
            row.support_gate = {"type": "copyright"}
            row.r2_url = None
            if row.atproto_record_uri:
                await rebuild_track_pds_record(row, auth_session)
            await db.commit()

        await schedule_move_track_audio(track.id, to_private=True)

    logger.info(
        "wrote indiemusi rights for track %s (song=%s recording=%s, moved=%s)",
        track.id,
        song_uri,
        recording_uri,
        transitioning_to_private,
    )
    return TrackRightsResult(song_uri=song_uri, recording_uri=recording_uri)


async def clear_track_rights(
    auth_session: AuthSession,
    track: Track,
) -> None:
    """delete indiemusi rights records for a track and clear the URI columns.

    best-effort PDS deletes — local state is cleared regardless. when the
    track was actually copyright-gated (support_gate.type == "copyright"),
    this also reverses the storage transition:
    - synchronously moves the file back to the public bucket so r2_url is
      repopulated before the rebuild runs (otherwise the PDS record stays
      pointed at /audio/{file_id} with stale supportGate metadata)
    - clears support_gate + URI columns
    - rebuilds the fm.plyr.track PDS record with the fresh public r2_url
      so reading clients see the canonical state

    if the track had a different support_gate (e.g., atprotofans supporter
    gating that pre-dated the copyright write — shouldn't be reachable with
    the mutex in write_track_rights, but defensive), that gate is left alone
    and no move is scheduled.
    """
    was_copyright_gated = _is_copyright_gate(track.support_gate)
    track_id = track.id

    for uri in (track.copyright_song_uri, track.copyright_recording_uri):
        if not uri:
            continue
        try:
            await delete_record_by_uri(auth_session, uri)
        except Exception as e:
            logger.warning("failed to delete %s: %s", uri, e)

    if was_copyright_gated:
        # move the file back to the public bucket synchronously so the
        # rebuild below has a valid r2_url to write into the PDS record.
        # `move_track_audio` updates the row's r2_url after a successful
        # copy. if this raises, local state stays gated and the user can
        # retry the clear.
        await move_track_audio(track_id, to_private=False)

    async with db_session() as db:
        result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist))
            .where(Track.id == track_id)
        )
        row = result.scalar_one()
        row.copyright_song_uri = None
        row.copyright_recording_uri = None
        if was_copyright_gated:
            row.support_gate = None

        if was_copyright_gated and row.atproto_record_uri:
            # post-move rebuild: r2_url is now populated, support_gate is
            # None — the PDS record's audioUrl flips back to r2_url and
            # supportGate is omitted. best-effort: a failure here leaves
            # the record with /audio/{file_id} which still serves correctly
            # via redirect, just with stale supportGate metadata.
            try:
                await rebuild_track_pds_record(row, auth_session)
            except Exception as e:
                logger.warning(
                    "failed to rebuild fm.plyr.track record on clear for %s: %s",
                    track_id,
                    e,
                )

        await db.commit()
