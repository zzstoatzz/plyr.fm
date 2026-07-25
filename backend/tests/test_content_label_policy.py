"""Policy tests for the two label families.

They differ in *who decides*, and that is the whole design:

- adult labels are a rendering default a listener may override for themselves
- a copyright label is an assertion about whether we should keep surfacing a
  track from our own storage, which no listener preference can answer

Neither gates the audio bytes. See `docs/internal/moderation/label-policy.md`.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.content_labels import (
    COPYRIGHT_LABELS,
    PROJECTED_LABEL_VALUES,
    filter_sensitive_audio_tracks_for_viewer,
    has_copyright_label,
    may_stream_sensitive_audio,
)
from backend.models import Artist, Track, UserPreferences

OWNER = "did:plc:owner"
VIEWER = "did:plc:viewer"


async def _track(
    db: AsyncSession,
    *,
    file_id: str,
    operator_labels: list[str] | None = None,
    self_labels: list[str] | None = None,
    artist_did: str = OWNER,
) -> Track:
    if not await db.get(Artist, artist_did):
        db.add(
            Artist(
                did=artist_did,
                handle=f"{artist_did[-5:]}.test",
                display_name=artist_did[-5:],
            )
        )
        await db.flush()
    track = Track(
        title=f"track {file_id}",
        artist_did=artist_did,
        file_id=file_id,
        file_type="audio/mpeg",
        visibility="public",
        operator_labels=operator_labels or [],
        self_labels=self_labels or [],
    )
    db.add(track)
    await db.flush()
    return track


def test_copyright_is_projected_so_sql_filters_can_read_it() -> None:
    """Discovery filters read tracks.operator_labels, not the labeler."""
    assert COPYRIGHT_LABELS <= PROJECTED_LABEL_VALUES


def test_copyright_label_recognised() -> None:
    assert has_copyright_label({"copyright-violation"})
    assert not has_copyright_label({"sexual"})


async def test_copyright_hides_from_shared_surfaces_for_everyone(
    db_session: AsyncSession,
) -> None:
    """Including the uploader: radio and feeds are us broadcasting, not their library."""
    flagged = await _track(
        db_session, file_id="cr1", operator_labels=["copyright-violation"]
    )
    clean = await _track(db_session, file_id="cr2")
    await db_session.commit()

    for viewer in (None, VIEWER, OWNER):
        visible, _ = await filter_sensitive_audio_tracks_for_viewer(
            db_session, [flagged, clean], viewer
        )
        assert [t.id for t in visible] == [clean.id], f"viewer={viewer}"


async def test_sensitive_opt_in_does_not_reveal_copyright_tracks(
    db_session: AsyncSession,
) -> None:
    """The regression the composed clause exists to prevent.

    The old shape skipped the whole visibility predicate for viewers who
    opted into sensitive audio, so folding copyright into that predicate
    without composing it would have leaked to exactly those viewers.
    """
    flagged = await _track(
        db_session, file_id="cr3", operator_labels=["copyright-violation"]
    )
    db_session.add(UserPreferences(did=VIEWER, show_sensitive_audio=True))
    await db_session.commit()

    visible, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [flagged], VIEWER
    )
    assert visible == []


async def test_adult_stays_a_viewer_preference(db_session: AsyncSession) -> None:
    adult = await _track(db_session, file_id="ad1", operator_labels=["sexual"])
    await db_session.commit()

    anon, _ = await filter_sensitive_audio_tracks_for_viewer(db_session, [adult], None)
    assert anon == []

    owner, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [adult], OWNER
    )
    assert [t.id for t in owner] == [adult.id]

    db_session.add(UserPreferences(did=VIEWER, show_sensitive_audio=True))
    await db_session.commit()
    opted_in, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [adult], VIEWER
    )
    assert [t.id for t in opted_in] == [adult.id]


async def test_no_label_gates_the_bytes(db_session: AsyncSession) -> None:
    """Both families de-list; neither denies a permalink."""
    for labels in ({"sexual"}, {"porn"}, {"copyright-violation"}, set()):
        assert await may_stream_sensitive_audio(
            db_session, labels=labels, artist_did=OWNER, session=None
        )
