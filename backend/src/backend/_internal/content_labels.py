"""Content-label interpretation and viewer policy.

The moderation service owns label state. This module is the deliberately small
policy boundary that translates interoperable ATProto values into plyr.fm
behavior; classifier evidence and moderation workflow state do not belong here.
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.auth.session import Session
from backend._internal.clients.moderation import get_moderation_client
from backend.models import Track, UserPreferences

ADULT_AUDIO_LABELS = frozenset({"sexual", "porn"})


def has_adult_audio_label(labels: Iterable[str]) -> bool:
    """Return whether labels require the adult-audio preference."""
    return bool(ADULT_AUDIO_LABELS.intersection(labels))


async def get_track_label_values(tracks: Iterable[Track]) -> dict[int, set[str]]:
    """Union creator self-labels with active operator labels by track."""
    track_list = list(tracks)
    effective = {track.id: set(track.self_labels or []) for track in track_list}
    operator = await get_operator_label_values(track_list)
    for track_id, values in operator.items():
        effective[track_id].update(values)
    return effective


async def get_operator_label_values(
    tracks: Iterable[Track],
) -> dict[int, set[str]]:
    """Return active operator labels without creator self-labels."""
    track_list = list(tracks)
    operator = {track.id: set() for track in track_list}
    tracks_with_uris = [track for track in track_list if track.atproto_record_uri]
    if not tracks_with_uris:
        return operator

    uris = [
        track.atproto_record_uri
        for track in tracks_with_uris
        if track.atproto_record_uri is not None
    ]
    by_uri = await get_moderation_client().get_active_label_values(uris)
    for track in tracks_with_uris:
        operator[track.id].update(by_uri.get(track.atproto_record_uri, set()))
    return operator


async def viewer_shows_sensitive_audio(
    db: AsyncSession, session: Session | None
) -> bool:
    """Return the listener's saved adult-audio preference.

    Anonymous viewers and authenticated viewers without a preference row use
    the safe default. Track owners are handled per track by the caller.
    """
    if session is None:
        return False
    value = await db.scalar(
        select(UserPreferences.show_sensitive_audio).where(
            UserPreferences.did == session.did
        )
    )
    return bool(value)


async def viewer_did_shows_sensitive_audio(
    db: AsyncSession, viewer_did: str | None
) -> bool:
    """Return the saved audio preference when only a viewer DID is available."""
    if viewer_did is None:
        return False
    value = await db.scalar(
        select(UserPreferences.show_sensitive_audio).where(
            UserPreferences.did == viewer_did
        )
    )
    return bool(value)


async def filter_sensitive_audio_tracks(
    db: AsyncSession,
    tracks: Iterable[Track],
    session: Session | None,
) -> tuple[list[Track], dict[int, set[str]]]:
    """Hide adult-labeled tracks unless the viewer opted in or owns them."""
    track_list = list(tracks)
    return await filter_sensitive_audio_tracks_for_viewer(
        db,
        track_list,
        session.did if session else None,
    )


async def filter_sensitive_audio_tracks_for_viewer(
    db: AsyncSession,
    tracks: Iterable[Track],
    viewer_did: str | None,
) -> tuple[list[Track], dict[int, set[str]]]:
    """Hide adult-labeled tracks for a viewer identified only by DID."""
    track_list = list(tracks)
    labels_by_id = await get_track_label_values(track_list)
    if await viewer_did_shows_sensitive_audio(db, viewer_did):
        return track_list, labels_by_id

    visible = [
        track
        for track in track_list
        if track.artist_did == viewer_did
        or not has_adult_audio_label(labels_by_id.get(track.id, set()))
    ]
    return visible, labels_by_id


async def may_stream_sensitive_audio(
    db: AsyncSession,
    *,
    labels: Iterable[str],
    artist_did: str,
    session: Session | None,
) -> bool:
    """Authorize a labeled audio stream for its owner or an opted-in adult."""
    if not has_adult_audio_label(labels):
        return True
    if session is None:
        return False
    if session.did == artist_did:
        return True
    return await viewer_shows_sensitive_audio(db, session)
