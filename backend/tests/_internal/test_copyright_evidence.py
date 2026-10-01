"""what counts as a recording being present in an upload.

every shape here is one measured in production scans; see
docs/internal/moderation/copyright-detection.md.
"""

from typing import Any

from backend._internal.copyright_evidence import song_evidence


def _timecode(seconds: int) -> str:
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def played_through(
    artist: str,
    title: str,
    segments: int,
    *,
    upload_start: int = 0,
    song_start: int = 20,
) -> list[dict[str, Any]]:
    """a recording playing in step with the upload for `segments` samples."""
    return [
        {
            "artist": artist,
            "title": title,
            "offset_ms": (upload_start + 12 * i) * 1000,
            "timecode": _timecode(song_start + 12 * i),
        }
        for i in range(segments)
    ]


def test_single_stray_match_is_not_evidence() -> None:
    # the old rule scored this 1 of 1 = 100% dominant and flagged it
    matches = [{"artist": "A", "title": "T", "offset_ms": 84000, "timecode": "00:20"}]
    assert song_evidence(matches) == []


def test_different_songs_at_one_position_are_not_evidence() -> None:
    matches = [
        {"artist": f"Artist {i}", "title": "T", "offset_ms": 0, "timecode": "00:30"}
        for i in range(3)
    ]
    assert song_evidence(matches) == []


def test_recording_played_through_is_evidence() -> None:
    [found] = song_evidence(played_through("Beartooth", "The Surface", 18))
    assert (found.artist, found.title) == ("Beartooth", "The Surface")
    assert found.in_step_segments == 18
    assert (found.start_seconds, found.end_seconds) == (0, 216)


def test_shared_loop_matching_many_positions_is_not_evidence() -> None:
    # an original built on a sample pack: the same reference loop matches at
    # many upload positions, but its timecode never advances with them
    matches = [
        {"artist": "A", "title": "Loop", "offset_ms": 12000 * i, "timecode": "00:10"}
        for i in (0, 2, 3, 5)
    ] + [
        {"artist": "B", "title": "Other", "offset_ms": 12000 * i, "timecode": "00:40"}
        for i in (1, 4, 6, 7)
    ]
    assert song_evidence(matches) == []


def test_mix_reports_each_recording_strongest_first() -> None:
    matches = (
        played_through("One", "A", 5, upload_start=0)
        + played_through("Two", "B", 9, upload_start=300)
        + [{"artist": "Noise", "title": "N", "offset_ms": 60000, "timecode": "02:00"}]
    )
    assert [(e.artist, e.in_step_segments) for e in song_evidence(matches)] == [
        ("Two", 9),
        ("One", 5),
    ]


def test_recording_looped_for_the_whole_upload_is_evidence() -> None:
    # a short clip on repeat: every sample matches, the timecode keeps resetting
    matches = [
        {
            "artist": "Bag Raiders",
            "title": "Shooting Stars",
            "offset_ms": 12000 * i,
            "timecode": _timecode(30 + 12 * (i % 2)),
        }
        for i in range(30)
    ]
    [found] = song_evidence(matches)
    assert found.segments == 30
    assert found.in_step_segments < 4


def test_three_segments_in_step_is_below_the_bar() -> None:
    assert song_evidence(played_through("A", "T", 3)) == []
    assert len(song_evidence(played_through("A", "T", 4))) == 1


def test_matches_without_positions_are_ignored() -> None:
    matches = [{"artist": "A", "title": "T", "score": 0} for _ in range(10)]
    assert song_evidence(matches) == []
