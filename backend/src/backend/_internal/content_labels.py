"""Content-label interpretation and viewer policy.

The moderation service owns label state. This module is the deliberately small
policy boundary that translates interoperable ATProto values into plyr.fm
behavior; classifier evidence and moderation workflow state do not belong here.
"""

from collections.abc import Iterable
from enum import StrEnum

from sqlalchemy import ColumnElement, select
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.auth.session import Session
from backend._internal.clients.moderation import get_moderation_client
from backend.models import Track, UserPreferences

ADULT_AUDIO_LABELS = frozenset({"sexual", "porn"})
COPYRIGHT_LABELS = frozenset({"copyright-violation"})

# Label values reconciled onto `tracks.operator_labels` by the
# sync_operator_labels background task. Only these values may be read from
# the projection; anything else must be queried from the labeler live.
PROJECTED_LABEL_VALUES = ADULT_AUDIO_LABELS | COPYRIGHT_LABELS


def has_adult_audio_label(labels: Iterable[str]) -> bool:
    """Return whether labels mark this as adult audio."""
    return bool(ADULT_AUDIO_LABELS.intersection(labels))


def has_copyright_label(labels: Iterable[str]) -> bool:
    """Return whether an operator has asserted a copyright violation."""
    return bool(COPYRIGHT_LABELS.intersection(labels))


def get_track_label_values(tracks: Iterable[Track]) -> dict[int, set[str]]:
    """Union creator self-labels with projected operator labels by track.

    Reads only track columns — operator labels come from the projection kept
    fresh by sync_operator_labels, not a live labeler query. Authorization
    paths (streaming bytes) must not use this; they query the labeler with
    strict=True instead.
    """
    return {
        track.id: set(track.self_labels or []) | set(track.operator_labels or [])
        for track in tracks
    }


def _labeled_with(values: frozenset[str]) -> ColumnElement[bool]:
    """SQL predicate: the track carries any of these label values."""
    wanted = array(sorted(values))
    return Track.self_labels.op("?|")(wanted) | Track.operator_labels.op("?|")(wanted)


def sensitive_audio_visible_clause(viewer_did: str | None) -> ColumnElement[bool]:
    """SQL predicate: the track needs no adult-audio opt-in from this viewer.

    Callers skip the clause entirely for viewers whose saved preference shows
    sensitive audio (see viewer_shows_sensitive_audio).
    """
    labeled = _labeled_with(ADULT_AUDIO_LABELS)
    if viewer_did is None:
        return ~labeled
    return ~labeled | (Track.artist_did == viewer_did)


def copyright_visible_clause() -> ColumnElement[bool]:
    """SQL predicate: the track carries no active copyright-violation label.

    Unlike adult audio, this takes no viewer and honours no preference. Adult
    labels are a rendering default a listener may override for themselves;
    a copyright assertion is about whether *we* should keep surfacing the
    track from our own storage, which no listener preference can answer.

    Deliberately not owner-exempt on shared surfaces. Creators still see and
    manage their own flagged tracks — the owner library (`list_my_tracks`)
    filters on artist_did alone and never applies this clause.
    """
    return ~_labeled_with(COPYRIGHT_LABELS)


class LabelContext(StrEnum):
    """Where a track is being rendered.

    Mirrors ATProto's moderation contexts, where the same content is filtered
    from a feed (`contentList`) but shown when opened directly (`contentView`).
    Bluesky's client makes this distinction per render; we make it per query,
    because our filtering has to live in SQL to compose with cursor pagination
    (#1676).
    """

    #: a surface where we choose what to put in front of someone — feeds,
    #: search, radio, recommendations
    LIST = "list"
    #: a page someone navigated to — an artist's catalogue, a collection.
    #: They already found it; hiding part of it misrepresents what is there.
    VIEW = "view"


def label_visible_clause(
    viewer_did: str | None,
    *,
    shows_sensitive_audio: bool,
    context: LabelContext = LabelContext.LIST,
) -> ColumnElement[bool]:
    """SQL predicate for showing a track, given where it is being shown.

    Composes both label families and the operator override in one place so a
    caller cannot apply one and not the others. An earlier shape skipped the
    whole predicate for viewers who opted into sensitive audio, which would
    have leaked copyright-labeled tracks to exactly those viewers.

    `exclude` hides a track with no label needed. `allow` surfaces one whose
    copyright label we reviewed and decided not to act on — a cover, say —
    without negating the label and thereby claiming the match never happened.
    `allow` deliberately does not lift the adult half: that is a listener
    preference, and an operator deciding what someone else may be *shown* is a
    different power from deciding what we *host*.
    """
    # NULL-safe: the column is null for almost every track, and `NOT (NULL =
    # 'exclude')` is NULL, which a WHERE clause drops. That would have hidden
    # the entire catalogue.
    allowed = Track.moderation_override.is_not_distinct_from("allow")
    not_excluded = Track.moderation_override.is_distinct_from("exclude")

    # copyright is a hosting obligation, so it applies in every context and
    # only an explicit operator decision lifts it
    visible = allowed | copyright_visible_clause()

    # adult labels are a rendering default, so they apply only where we are
    # choosing what to surface
    if context is LabelContext.LIST and not shows_sensitive_audio:
        visible = visible & sensitive_audio_visible_clause(viewer_did)

    return not_excluded & visible


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
    labels_by_id = get_track_label_values(track_list)
    shows_sensitive = await viewer_did_shows_sensitive_audio(db, viewer_did)

    visible = []
    for track in track_list:
        labels = labels_by_id.get(track.id, set())
        override = track.moderation_override
        if override == "exclude":
            continue
        # copyright applies to everyone; no preference and no owner exemption,
        # unless an operator reviewed it and decided to surface it anyway
        if has_copyright_label(labels) and override != "allow":
            continue
        if (
            shows_sensitive
            or track.artist_did == viewer_did
            or not has_adult_audio_label(labels)
        ):
            visible.append(track)
    return visible, labels_by_id


async def may_stream_sensitive_audio(
    db: AsyncSession,
    *,
    labels: Iterable[str],
    artist_did: str,
    session: Session | None,
) -> bool:
    """Adult labels never gate the bytes themselves.

    They are a rendering default for shared surfaces, not an access control.
    Requiring a session here looked like age verification but was not — any
    account satisfied it, and plyr verifies nobody's age — while breaking the
    thing it cost most: a creator sharing a direct link to their own work with
    someone who is not signed in.

    Listeners still control what they are *shown*: adult-labeled tracks stay
    out of radio, feeds, search, and collections unless they opt in. Clients
    that want to warn before playing read the labels off the response.
    """
    return True
