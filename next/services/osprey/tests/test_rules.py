"""plyr's SML rules, run by Osprey's real engine with the plugin's UDFs."""

from datetime import UTC, datetime
from typing import Any

from osprey.engine.executor.execution_context import Action, ExecutionResult

from plyr_osprey.udfs import FlagEffect

NEXT_AUDIO = 'https://plyr-next-audio.n8-3e9.workers.dev/audio/abc.mp3'
URI = 'at://did:plc:uploader/fm.plyr.track/3k'


def played_through(artist: str, segments: int) -> list[dict[str, Any]]:
    return [
        {'artist': artist, 'title': 'Hit', 'offset_ms': 12_000 * i, 'timecode': f'00:{20 + 12 * i:02d}'}
        for i in range(segments)
    ]


def run(engine, audio_url: str | None, scanned_before: bool = False) -> ExecutionResult:
    osprey, helpers = engine
    data = {
        'uri': URI,
        'cid': 'bafy',
        'did': 'did:plc:uploader',
        'title': 'a song',
        'audio_url': audio_url,
        'handle': 'uploader.bsky.social',
        'display_name': 'Uploader',
        'scanned_before': scanned_before,
    }
    action = Action(action_id=1, action_name='track', data=data, timestamp=datetime.now(UTC))
    return osprey.execute(helpers, action)


def flags(result: ExecutionResult) -> list[FlagEffect]:
    return [e for e in result.effects.get(FlagEffect, []) if isinstance(e, FlagEffect)]


def test_someone_elses_recording_playing_through_is_flagged(engine, fingerprinter) -> None:
    fingerprinter.by_url[NEXT_AUDIO] = played_through('Beartooth', 4)
    result = run(engine, NEXT_AUDIO)
    assert result.error_infos == []
    [flag] = flags(result)
    assert (flag.subject, flag.action, flag.actor) == (URI, 'flagged_by_scan', 'scan:audd')
    assert flag.reason == 'Beartooth - Hit (0:00-0:48)'


def test_a_stray_match_or_the_uploaders_own_catalog_is_not(engine, fingerprinter) -> None:
    fingerprinter.by_url[NEXT_AUDIO] = played_through('Beartooth', 3) + played_through('Uploader', 9)
    result = run(engine, NEXT_AUDIO)
    assert result.error_infos == []
    assert flags(result) == []
    assert result.extracted_features['Recordings'] == []


def test_only_audio_next_stored_is_scanned(engine, fingerprinter) -> None:
    for url in ('https://audio.plyr.fm/abc.mp3', 'http://plyr-next-audio.n8-3e9.workers.dev/abc.mp3', None):
        result = run(engine, url)
        assert flags(result) == []
        assert 'Recordings' not in result.extracted_features
    assert fingerprinter.scanned == []


def test_audio_scanned_before_is_not_scanned_again(engine, fingerprinter) -> None:
    fingerprinter.by_url[NEXT_AUDIO] = played_through('Beartooth', 6)
    assert flags(run(engine, NEXT_AUDIO, scanned_before=True)) == []
    assert fingerprinter.scanned == []


def test_a_failed_scan_is_an_error_not_a_clean_result(engine, fingerprinter) -> None:
    fingerprinter.failing.add(NEXT_AUDIO)
    result = run(engine, NEXT_AUDIO)
    assert result.error_infos
    assert flags(result) == []
