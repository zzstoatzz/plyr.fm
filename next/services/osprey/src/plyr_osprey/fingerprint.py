"""audio fingerprinting through plyr's moderation service, which holds the AuDD key.

`POST {base}/scan {"audio_url": ...}` returns AuDD's per-sample matches
(services/moderation/src/audd.rs). the service only fingerprints; what a
match means is decided here and in the rules.
"""

from typing import Any, Protocol

import requests


class Fingerprinter(Protocol):
    def matches(self, audio_url: str) -> list[dict[str, Any]]: ...


class ModerationServiceFingerprinter:
    def __init__(self, base_url: str, auth_token: str, timeout_seconds: float = 180.0) -> None:
        self._url = base_url.rstrip('/') + '/scan'
        self._headers = {'X-Moderation-Key': auth_token, 'User-Agent': 'plyr.fm-next-osprey/0.1 (+https://plyr.fm)'}
        self._timeout = timeout_seconds

    def matches(self, audio_url: str) -> list[dict[str, Any]]:
        response = requests.post(self._url, json={'audio_url': audio_url}, headers=self._headers, timeout=self._timeout)
        response.raise_for_status()
        body = response.json()
        found = body.get('matches') if isinstance(body, dict) else None
        if not isinstance(found, list):
            raise TypeError('scan response has no matches list')
        return [m for m in found if isinstance(m, dict)]


class Unconfigured:
    def matches(self, audio_url: str) -> list[dict[str, Any]]:
        raise RuntimeError('no fingerprinter configured')
