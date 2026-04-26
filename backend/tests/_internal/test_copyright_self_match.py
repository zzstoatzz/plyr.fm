"""regression: self-match copyright flags must not surface to UI or DMs.

history: 2026-04-25 — flo.by uploaded a batch of his own catalog. AuDD
identified each track's dominant match as "Floby IV" (his stage name),
so every scan came back is_flagged=true. that path:
  - wrote `copyright_scans.is_flagged=true` (visible to creator on /portal)
  - fired admin DM "copyright flag on plyr.fm / primary: X by Floby IV"

the artist saw red badges on his own tracks and reached out; the admin
got 30 DM spams in an hour. the perpetual sync flipped is_flagged=false
within 5min, but only after the damage was done.

fix: detect self-match by comparing slugified dominant artist vs uploader
handle/display_name. demote is_flagged to false at write time so the UI
flag and the DM never fire.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.moderation import (
    _dominant_match_artist,
    _is_self_match,
    _store_scan_result,
)
from backend.models import Artist, CopyrightScan, Track


@dataclass
class _FakeScanResult:
    is_flagged: bool
    highest_score: int
    matches: list[dict[str, Any]]
    raw_response: dict[str, Any]


def _matches(*pairs: tuple[str, str]) -> list[dict[str, Any]]:
    return [{"artist": a, "title": t, "score": 0} for a, t in pairs]


# --- unit: _is_self_match ---


class TestIsSelfMatch:
    def test_floby_iv_matches_flo_by_handle(self) -> None:
        # the actual case that triggered this fix
        assert _is_self_match("Floby IV", "flo.by", "flo.by") is True

    def test_exact_handle_match(self) -> None:
        assert _is_self_match("knock2one", "knock2one.bsky.social", "knock2one") is True

    def test_display_name_substring(self) -> None:
        assert _is_self_match("Mister X", "msx.bsky.social", "Mister") is True

    def test_unrelated_artist_is_not_self_match(self) -> None:
        # j4ck.xyz uploaded a Conan Gray cover — should NOT be suppressed
        assert _is_self_match("Conan Gray", "j4ck.xyz", "j4ck.xyz") is False

    def test_unrelated_artist_zedd(self) -> None:
        # natalie.sh's "mid 123" matched "Zedd" — should NOT be suppressed
        assert _is_self_match("Zedd", "natalie.sh", "natalie.sh") is False

    def test_short_match_artist_not_suppressed(self) -> None:
        # 3-char artist would otherwise over-match; require min slug length
        assert _is_self_match("DJ", "djsomething.bsky.social", "DJ Some") is False

    def test_empty_uploader_display_safe(self) -> None:
        assert _is_self_match("Floby IV", "flo.by", "") is True

    def test_empty_match_returns_false(self) -> None:
        assert _is_self_match("", "flo.by", "flo.by") is False


# --- unit: _dominant_match_artist ---


class TestDominantMatchArtist:
    def test_picks_most_frequent(self) -> None:
        ms = _matches(
            ("Floby IV", "Summer Heat"),
            ("Floby IV", "Summer Heat"),
            ("Other", "song"),
        )
        assert _dominant_match_artist(ms) == "Floby IV"

    def test_empty_returns_none(self) -> None:
        assert _dominant_match_artist([]) is None

    def test_skips_blank_artists(self) -> None:
        ms = [{"artist": "", "title": "x"}, {"artist": "Real", "title": "y"}]
        assert _dominant_match_artist(ms) == "Real"


# --- integration: _store_scan_result demotes self-matches ---


async def _make_artist_and_track(
    db: AsyncSession,
    *,
    handle: str = "flo.by",
    display_name: str = "flo.by",
    did: str = "did:plc:test-flo",
    title: str = "Summer Heat",
) -> Track:
    artist = Artist(did=did, handle=handle, display_name=display_name)
    db.add(artist)
    await db.commit()
    track = Track(
        title=title,
        file_id="abc123",
        file_type="mp3",
        artist_did=did,
        r2_url="https://audio.plyr.fm/audio/abc123.mp3",
    )
    db.add(track)
    await db.commit()
    await db.refresh(track)
    return track


async def test_store_scan_result_suppresses_self_match(
    db_session: AsyncSession,
) -> None:
    track = await _make_artist_and_track(db_session)
    scan_result = _FakeScanResult(
        is_flagged=True,
        highest_score=0,
        matches=_matches(
            ("Floby IV", "Summer Heat"),
            ("Floby IV", "Summer Heat"),
            ("Floby IV", "Summer Heat"),
        ),
        raw_response={},
    )

    with patch(
        "backend._internal.moderation.notification_service.send_copyright_flag_notification",
        new_callable=AsyncMock,
    ) as mock_dm:
        await _store_scan_result(track.id, scan_result)

    # row was written with is_flagged=false (no UI flag)
    rows = (
        (
            await db_session.execute(
                select(CopyrightScan).where(CopyrightScan.track_id == track.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].is_flagged is False
    # admin DM NEVER fires for self-matches
    mock_dm.assert_not_called()


async def test_store_scan_result_real_violation_still_flags(
    db_session: AsyncSession,
) -> None:
    track = await _make_artist_and_track(
        db_session,
        handle="j4ck.xyz",
        display_name="j4ck.xyz",
        did="did:plc:test-j4ck",
        title="acoustic guitar cover of vodka cranberry",
    )
    scan_result = _FakeScanResult(
        is_flagged=True,
        highest_score=0,
        matches=_matches(
            ("Conan Gray", "Vodka Cranberry"),
            ("Conan Gray", "Vodka Cranberry"),
            ("Conan Gray", "Vodka Cranberry"),
        ),
        raw_response={},
    )

    with patch(
        "backend._internal.moderation.notification_service.send_copyright_flag_notification",
        new_callable=AsyncMock,
    ) as mock_dm:
        await _store_scan_result(track.id, scan_result)

    rows = (
        (
            await db_session.execute(
                select(CopyrightScan).where(CopyrightScan.track_id == track.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    # genuine non-self-match: flag stays true and admin gets DM
    assert rows[0].is_flagged is True
    mock_dm.assert_awaited_once()


async def test_store_scan_result_clear_path_unchanged(
    db_session: AsyncSession,
) -> None:
    track = await _make_artist_and_track(db_session, did="did:plc:test-clear")
    scan_result = _FakeScanResult(
        is_flagged=False,
        highest_score=0,
        matches=[],
        raw_response={},
    )

    with patch(
        "backend._internal.moderation.notification_service.send_copyright_flag_notification",
        new_callable=AsyncMock,
    ) as mock_dm:
        await _store_scan_result(track.id, scan_result)

    rows = (
        (
            await db_session.execute(
                select(CopyrightScan).where(CopyrightScan.track_id == track.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].is_flagged is False
    mock_dm.assert_not_called()
