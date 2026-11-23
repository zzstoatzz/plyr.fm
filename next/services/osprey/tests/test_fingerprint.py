import pytest
import requests

from plyr_osprey.fingerprint import ModerationServiceFingerprinter


class Response:
    def __init__(self, status: int, body: object) -> None:
        self.status_code, self._body = status, body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))

    def json(self) -> object:
        return self._body


def test_scan_asks_the_moderation_service(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = {}

    def post(url, json, headers, timeout):
        sent.update(url=url, json=json, key=headers['X-Moderation-Key'])
        return Response(200, {'matches': [{'artist': 'A', 'title': 'T'}, 'junk'], 'highest_score': 0})

    monkeypatch.setattr(requests, 'post', post)
    found = ModerationServiceFingerprinter('https://moderation.example/', 'k').matches('https://x/a.mp3')
    assert found == [{'artist': 'A', 'title': 'T'}]
    assert sent == {'url': 'https://moderation.example/scan', 'json': {'audio_url': 'https://x/a.mp3'}, 'key': 'k'}


@pytest.mark.parametrize('response', [Response(503, {}), Response(200, {'error': 'audd'})])
def test_a_failed_scan_raises(monkeypatch: pytest.MonkeyPatch, response: Response) -> None:
    monkeypatch.setattr(requests, 'post', lambda *a, **k: response)
    with pytest.raises((requests.HTTPError, TypeError)):
        ModerationServiceFingerprinter('https://m', 'k').matches('https://x/a.mp3')
