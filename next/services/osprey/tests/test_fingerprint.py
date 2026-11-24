import shutil
import wave

import pytest
import requests

from plyr_osprey.fingerprint import AudDFingerprinter, FfprobeProber, ScanPlan, matches_from

SHORT = ScanPlan.for_length(180)


class Response:
    def __init__(self, status: int, body: object) -> None:
        self.status_code, self._body = status, body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))

    def json(self) -> object:
        return self._body


def test_scan_asks_audd_with_accurate_offsets(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = {}

    def post(url, data, headers, timeout):
        sent.update(url=url, data=data)
        return Response(200, {'status': 'success', 'result': None})

    monkeypatch.setattr(requests, 'post', post)
    assert AudDFingerprinter('k').matches('https://x/a.mp3', SHORT) == []
    assert sent == {
        'url': 'https://enterprise.audd.io/',
        'data': {'api_token': 'k', 'url': 'https://x/a.mp3', 'accurate_offsets': '1', 'limit': '15'},
    }
    AudDFingerprinter('k').matches('https://x/a.mp3', ScanPlan.for_length(1200))
    assert sent['data'] == {
        'api_token': 'k',
        'url': 'https://x/a.mp3',
        'accurate_offsets': '1',
        'limit': '50',
        'every': '1',
        'skip': '1',
    }


@pytest.mark.parametrize(
    ('measured', 'claimed', 'stride', 'charge', 'chunks'),
    [
        (180, 0, 1, 180, 15),
        (600, 0, 1, 600, 50),
        (601, 0, 2, 601, 26),
        (1800, 0, 2, 1800, 75),
        (3600, 0, 3, 3600, 100),
        (6 * 3600, 0, 3, 3 * 3600, 300),  # nothing is charged or heard past three hours
        (3600, 1, 3, 3600, 100),  # the measured length wins over what the record claims
        # unmeasured: charged the claim or ten minutes, and heard to three hours whatever it claims
        (None, 0, 1, 600, 900),
        (None, 1, 1, 600, 900),
        (None, 3600, 3, 3600, 300),
    ],
)
def test_the_measured_length_decides_the_charge_and_what_is_heard(measured, claimed, stride, charge, chunks) -> None:
    plan = ScanPlan.for_length(measured, claimed)
    assert (plan.stride, plan.charge_seconds, plan.max_chunks) == (stride, charge, chunks)


def test_samples_become_one_match_per_song_with_offsets() -> None:
    body = {
        'status': 'success',
        'result': [
            {
                'offset': '01:12',
                'songs': [{'artist': 'A', 'title': 'T', 'score': 100, 'timecode': '00:40', 'isrc': 'I'}],
            },
            {'offset': 144000, 'songs': [{'title': 'U'}, 'junk']},
            {'offset': 'x', 'songs': None},
        ],
    }
    assert matches_from(body) == [
        {'artist': 'A', 'title': 'T', 'score': 100, 'isrc': 'I', 'timecode': '00:40', 'offset_ms': 72000},
        {'artist': 'Unknown', 'title': 'U', 'score': 0, 'offset_ms': 144000},
    ]


def test_a_single_song_has_no_offset() -> None:
    assert matches_from({'status': 'success', 'result': {'artist': 'A', 'title': 'T'}}) == [
        {'artist': 'A', 'title': 'T', 'score': 0}
    ]


@pytest.mark.parametrize(
    'response',
    [Response(503, {}), Response(200, {'status': 'error', 'error': {'error_code': 900}}), Response(200, ['x'])],
)
def test_a_failed_scan_raises(monkeypatch: pytest.MonkeyPatch, response: Response) -> None:
    monkeypatch.setattr(requests, 'post', lambda *a, **k: response)
    with pytest.raises((requests.HTTPError, RuntimeError, TypeError)):
        AudDFingerprinter('k').matches('https://x/a.mp3', SHORT)


@pytest.mark.skipif(shutil.which('ffprobe') is None, reason='ffprobe not installed')
def test_ffprobe_measures_the_file_not_the_record(tmp_path) -> None:
    path = tmp_path / 'tone.wav'
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b'\0\0' * 8000 * 25)
    assert FfprobeProber().seconds(str(path)) == 25
    junk = tmp_path / 'junk.mp3'
    junk.write_bytes(b'not audio')
    assert FfprobeProber().seconds(str(junk)) is None
