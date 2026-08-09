"""Policy tests for the two label families.

They differ in *who decides*, and that is the whole design:

- adult labels are a rendering default a listener may override for themselves
- a copyright label is an assertion about whether we should keep surfacing a
  track from our own storage, which no listener preference can answer

Neither gates the audio bytes. See `docs/internal/moderation/label-policy.md`.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.content_labels import (
    COPYRIGHT_LABELS,
    PROJECTED_LABEL_VALUES,
    LabelContext,
    copyright_visible_clause,
    filter_sensitive_audio_tracks_for_viewer,
    has_copyright_label,
    label_visible_clause,
    may_stream_sensitive_audio,
)
from backend.models import Artist, Track, UserPreferences

OWNER = "did:plc:owner"
VIEWER = "did:plc:viewer"


async def _visible(
    db: AsyncSession, context: LabelContext, *, shows_sensitive: bool
) -> set[int]:
    """Track ids the SQL predicate admits for this artist in this context."""
    rows = await db.execute(
        select(Track)
        .where(Track.artist_did == OWNER)
        .where(
            label_visible_clause(
                VIEWER, shows_sensitive_audio=shows_sensitive, context=context
            )
        )
    )
    return {track.id for track in rows.scalars().all()}


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


async def test_override_allow_surfaces_a_copyright_labeled_track(
    db_session: AsyncSession,
) -> None:
    """The reason overrides exist: a real match we reviewed and decided to keep.

    Negating the label would claim the match never happened. An override says
    the assertion stands and we are surfacing it anyway.
    """
    cover = await _track(
        db_session,
        file_id="ov1",
        operator_labels=["copyright-violation"],
    )
    cover.moderation_override = "allow"
    await db_session.commit()

    visible, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [cover], None
    )
    assert [t.id for t in visible] == [cover.id]


async def test_override_exclude_hides_an_unlabeled_track(
    db_session: AsyncSession,
) -> None:
    """The other direction: keep something off chosen surfaces with no label."""
    track = await _track(db_session, file_id="ov2")
    track.moderation_override = "exclude"
    await db_session.commit()

    visible, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [track], OWNER, context=LabelContext.LIST
    )
    assert visible == []


async def test_override_allow_does_not_override_a_listeners_adult_preference(
    db_session: AsyncSession,
) -> None:
    """An operator decides what we host, not what someone else may be shown."""
    adult = await _track(db_session, file_id="ov3", operator_labels=["sexual"])
    adult.moderation_override = "allow"
    await db_session.commit()

    visible, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [adult], VIEWER
    )
    assert visible == []


async def test_view_context_shows_the_whole_catalogue(
    db_session: AsyncSession,
) -> None:
    """A page someone navigated to shows what is on it.

    Mirrors ATProto's contentList/contentView split: filtered from a feed,
    shown when opened directly. Regression for the artist page rendering
    "4 tracks" above a list of one.
    """
    labeled = await _track(db_session, file_id="dest1", operator_labels=["sexual"])
    plain = await _track(db_session, file_id="dest2")
    await db_session.commit()

    assert await _visible(db_session, LabelContext.VIEW, shows_sensitive=False) == {
        labeled.id,
        plain.id,
    }


async def test_list_context_still_hides_adult_from_a_viewer_who_opted_out(
    db_session: AsyncSession,
) -> None:
    labeled = await _track(db_session, file_id="dest3", operator_labels=["sexual"])
    plain = await _track(db_session, file_id="dest4")
    await db_session.commit()

    assert await _visible(db_session, LabelContext.LIST, shows_sensitive=False) == {
        plain.id
    }
    assert await _visible(db_session, LabelContext.LIST, shows_sensitive=True) == {
        labeled.id,
        plain.id,
    }


async def test_copyright_hides_in_every_context(db_session: AsyncSession) -> None:
    """ "I already found this artist" does not discharge a hosting obligation."""
    await _track(db_session, file_id="dest5", operator_labels=["copyright-violation"])
    plain = await _track(db_session, file_id="dest6")
    await db_session.commit()

    for context in (LabelContext.LIST, LabelContext.VIEW):
        assert await _visible(db_session, context, shows_sensitive=True) == {
            plain.id
        }, context


async def test_exclude_override_is_curation_not_removal(
    db_session: AsyncSession,
) -> None:
    """`exclude` empties chosen surfaces, never a page someone navigated to.

    Regression: exclude once applied in every context, so excluding an
    artist's tracks from radio also blanked their public profile ("no
    tracks") — a curation decision presented as a takedown. Removal outright
    is `takedown`'s job.
    """
    hidden = await _track(db_session, file_id="dest7")
    hidden.moderation_override = "exclude"
    plain = await _track(db_session, file_id="dest8")
    await db_session.commit()

    assert await _visible(db_session, LabelContext.LIST, shows_sensitive=True) == {
        plain.id
    }
    assert await _visible(db_session, LabelContext.VIEW, shows_sensitive=True) == {
        hidden.id,
        plain.id,
    }


async def test_app_side_filter_agrees_exclude_is_list_only(
    db_session: AsyncSession,
) -> None:
    """The Python filter and the SQL clause must agree on exclude's reach."""
    hidden = await _track(db_session, file_id="dest9")
    hidden.moderation_override = "exclude"
    plain = await _track(db_session, file_id="dest10")
    await db_session.commit()

    shown, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [hidden, plain], VIEWER, context=LabelContext.VIEW
    )
    assert {t.id for t in shown} == {hidden.id, plain.id}

    listed, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [hidden, plain], VIEWER, context=LabelContext.LIST
    )
    assert {t.id for t in listed} == {plain.id}


async def test_app_side_filter_honours_view_context(db_session: AsyncSession) -> None:
    """The Python filter and the SQL clause must agree on a destination.

    An album disagreeing with the artist page above it is precisely the
    inconsistency the context parameter exists to prevent — before this, the
    SQL path knew about VIEW and the app-side path did not.
    """
    labeled = await _track(db_session, file_id="ctx1", operator_labels=["sexual"])
    plain = await _track(db_session, file_id="ctx2")
    await db_session.commit()

    shown, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [labeled, plain], VIEWER, context=LabelContext.VIEW
    )
    assert {t.id for t in shown} == {labeled.id, plain.id}

    hidden, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [labeled, plain], VIEWER, context=LabelContext.LIST
    )
    assert {t.id for t in hidden} == {plain.id}


async def test_app_side_filter_keeps_copyright_hidden_in_view(
    db_session: AsyncSession,
) -> None:
    infringing = await _track(
        db_session, file_id="ctx3", operator_labels=["copyright-violation"]
    )
    plain = await _track(db_session, file_id="ctx4")
    await db_session.commit()

    shown, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [infringing, plain], VIEWER, context=LabelContext.VIEW
    )
    assert {t.id for t in shown} == {plain.id}


async def test_album_card_count_matches_what_the_album_will_show(
    db_session: AsyncSession,
) -> None:
    """A card promising more tracks than the page lists is the reported bug.

    The count is viewer-independent on purpose, so it excludes only what no
    viewer can see: copyright labels. Adult-labeled and override-excluded
    tracks stay counted because a VIEW context shows both.
    """
    from backend.models import Album

    keep = await _track(db_session, file_id="cnt1")  # also creates the artist
    album = Album(title="Mixed", artist_did=OWNER, slug="mixed")
    db_session.add(album)
    await db_session.flush()

    adult = await _track(db_session, file_id="cnt2", operator_labels=["sexual"])
    infringing = await _track(
        db_session, file_id="cnt3", operator_labels=["copyright-violation"]
    )
    excluded = await _track(db_session, file_id="cnt4")
    excluded.moderation_override = "exclude"
    for t in (keep, adult, infringing, excluded):
        t.album_id = album.id
    await db_session.commit()

    counted = (
        await db_session.execute(
            select(func.count(Track.id)).where(
                Track.album_id == album.id,
                Track.visibility != "private",
                copyright_visible_clause(),
            )
        )
    ).scalar_one()

    shown, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session,
        [keep, adult, infringing, excluded],
        None,
        context=LabelContext.VIEW,
    )
    assert counted == len(shown) == 3


async def test_owner_sees_their_own_adult_track_but_not_their_own_copyright_one(
    db_session: AsyncSession,
) -> None:
    """The owner exemption is scoped to the adult branch.

    Documented in label-policy.md, and easy to trip over: a check run as the
    owner passes whether or not the context split works. Pinned here so the
    documented rule and the code cannot drift.
    """
    adult = await _track(db_session, file_id="own1", operator_labels=["sexual"])
    infringing = await _track(
        db_session, file_id="own2", operator_labels=["copyright-violation"]
    )
    await db_session.commit()

    # OWNER, on a LIST surface, preference off
    shown, _ = await filter_sensitive_audio_tracks_for_viewer(
        db_session, [adult, infringing], OWNER, context=LabelContext.LIST
    )
    assert {t.id for t in shown} == {adult.id}, (
        "owner sees their own adult track, but never their own copyright one"
    )

    # a non-owner sees neither
    assert await _visible(db_session, LabelContext.LIST, shows_sensitive=False) == set()
