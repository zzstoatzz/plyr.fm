"""plyr's SML rules, run by Osprey's real engine with the plugin's UDFs."""

from datetime import UTC, datetime
from typing import Any

from osprey.engine.executor.execution_context import Action, ExecutionResult

from plyr_osprey.udfs import FlagEffect, HoldEffect

NEXT_AUDIO = 'https://plyr-next-audio.n8-3e9.workers.dev/audio/abc.mp3'
URI = 'at://did:plc:uploader/fm.plyr.track/3k'


def played_through(artist: str, segments: int) -> list[dict[str, Any]]:
    return [
        {'artist': artist, 'title': 'Hit', 'offset_ms': 12_000 * i, 'timecode': f'00:{20 + 12 * i:02d}'}
        for i in range(segments)
    ]


def run(
    engine,
    audio_url: str | None,
    scanned_before: bool = False,
    duration_seconds: int = 180,
    recent_uploads: int = 1,
    held: bool = False,
) -> ExecutionResult:
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
        'duration_seconds': duration_seconds,
        'recent_uploads': recent_uploads,
        'held': held,
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


def holds(result: ExecutionResult) -> list[HoldEffect]:
    return [e for e in result.effects.get(HoldEffect, []) if isinstance(e, HoldEffect)]


def test_a_scan_spends_the_uploaders_budget_for_the_files_measured_length(
    engine, fingerprinter, budget, prober
) -> None:
    prober.lengths[NEXT_AUDIO] = 240
    result = run(engine, NEXT_AUDIO, duration_seconds=1)
    assert result.error_infos == []
    assert budget.spends == [('did:plc:uploader', 240)]
    assert fingerprinter.plans[0].max_chunks == 20
    assert fingerprinter.scanned == [NEXT_AUDIO]
    assert holds(result) == []


def test_out_of_budget_a_track_is_held_not_scanned(engine, fingerprinter, budget) -> None:
    budget.spent.add('did:plc:uploader')
    result = run(engine, NEXT_AUDIO)
    assert result.error_infos == []
    assert fingerprinter.scanned == []
    assert 'Recordings' not in result.extracted_features
    assert [h.subject for h in holds(result)] == [URI]
    assert flags(result) == []


def test_a_failed_scan_gives_its_budget_back(engine, fingerprinter, budget, prober) -> None:
    prober.lengths[NEXT_AUDIO] = 300
    fingerprinter.failing.add(NEXT_AUDIO)
    assert run(engine, NEXT_AUDIO).error_infos
    assert budget.released == [('did:plc:uploader', 300)]


def test_a_long_file_is_sampled_and_its_mix_still_flagged(engine, fingerprinter, budget, prober) -> None:
    prober.lengths[NEXT_AUDIO] = 3600
    # an hour-long mix, heard one chunk in three: a song playing through it
    # turns up in three samples 36 seconds apart
    fingerprinter.by_url[NEXT_AUDIO] = [
        {'artist': 'Beartooth', 'title': 'Hit', 'offset_ms': 36_000 * i, 'timecode': f'00:{10 + 36 * i:02d}'}
        for i in range(3)
    ]
    result = run(engine, NEXT_AUDIO, duration_seconds=60)
    [plan] = fingerprinter.plans
    assert (plan.stride, plan.charge_seconds, plan.max_chunks) == (3, 3600, 100)
    assert budget.spends == [('did:plc:uploader', 3600)]
    [flag] = flags(result)
    assert flag.reason == 'Beartooth - Hit (0:00-1:24)'


def test_an_upload_burst_flags_the_account_once_per_step(engine, fingerprinter) -> None:
    for count in (19, 21, 99):
        assert [f for f in flags(run(engine, None, recent_uploads=count)) if f.actor == 'rule:volume'] == []
    [flag] = flags(run(engine, None, recent_uploads=20))
    assert (flag.subject, flag.action, flag.actor, flag.reason) == (
        'did:plc:uploader',
        'flagged_by_rule',
        'rule:volume',
        '20 tracks in a day',
    )
    # a held track coming round again was counted when it first came by
    assert flags(run(engine, None, recent_uploads=20, held=True)) == []
