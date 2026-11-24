"""audio fingerprinting: osprey asks AuDD itself, with the request prod's
moderation service made (services/moderation/src/audd.rs). AuDD only says which
recordings it hears where; what a match means is decided here and in the rules.
"""

import math
from dataclasses import dataclass
from typing import Any, Protocol

import requests

AUDD_URL = 'https://enterprise.audd.io/'
USER_AGENT = 'plyr.fm-next-osprey/0.1 (+https://plyr.fm)'

# AuDD's enterprise endpoint hears a file in 12-second chunks and bills each
# chunk it recognizes as one request (docs.audd.io/enterprise)
CHUNK_SECONDS = 12
# a track whose length next doesn't know yet is charged and scanned as this long
UNKNOWN_DURATION_SECONDS = 600
# no file is charged or scanned past this
MAX_SCAN_SECONDS = 3 * 3600


@dataclass(frozen=True)
class ScanPlan:
    """how much of a file AuDD hears, and what that costs the uploader's budget.

    a file up to 10 minutes is heard chunk by chunk, as before. a longer one
    (a mix, an hour of generated ambience) is sampled: one chunk in every
    `stride`, which still hears anything that plays for a minute or more, at a
    half or a third of the cost. `max_chunks` stops AuDD at what was paid for.
    """

    stride: int
    charge_seconds: int
    max_chunks: int

    @classmethod
    def for_duration(cls, duration_seconds: int | None) -> 'ScanPlan':
        seconds = duration_seconds if duration_seconds and duration_seconds > 0 else UNKNOWN_DURATION_SECONDS
        seconds = min(seconds, MAX_SCAN_SECONDS)
        stride = 1 if seconds <= 600 else 2 if seconds <= 1800 else 3
        return cls(stride=stride, charge_seconds=seconds, max_chunks=math.ceil(seconds / CHUNK_SECONDS / stride))

    def params(self) -> dict[str, str]:
        params = {'limit': str(self.max_chunks)}
        if self.stride > 1:
            params.update(every='1', skip=str(self.stride - 1))
        return params


class Fingerprinter(Protocol):
    def matches(self, audio_url: str, plan: ScanPlan) -> list[dict[str, Any]]: ...


class AudDFingerprinter:
    def __init__(self, api_token: str, url: str = AUDD_URL, timeout_seconds: float = 180.0) -> None:
        self._token = api_token
        self._url = url
        self._timeout = timeout_seconds

    def matches(self, audio_url: str, plan: ScanPlan) -> list[dict[str, Any]]:
        response = requests.post(
            self._url,
            data={'api_token': self._token, 'url': audio_url, 'accurate_offsets': '1', **plan.params()},
            headers={'User-Agent': USER_AGENT},
            timeout=self._timeout,
        )
        response.raise_for_status()
        return matches_from(response.json())


def matches_from(body: object) -> list[dict[str, Any]]:
    """AuDD's answer as one match per song heard, each with the offset into the
    upload where it was heard (offset_ms) and where in the song (timecode)."""
    if not isinstance(body, dict):
        raise TypeError('AuDD answered no object')
    if body.get('status') == 'error':
        raise RuntimeError(f'AuDD error: {body.get("error")}')
    result = body.get('result')
    if result is None:
        return []
    if isinstance(result, dict):
        return [_match(result, None)]
    if not isinstance(result, list):
        raise TypeError('AuDD result is neither a song nor a list of samples')
    found = []
    for group in result:
        if not isinstance(group, dict):
            continue
        offset_ms = _offset_ms(group.get('offset'))
        found.extend(_match(song, offset_ms) for song in group.get('songs') or [] if isinstance(song, dict))
    return found


def _match(song: dict[str, Any], offset_ms: int | None) -> dict[str, Any]:
    match: dict[str, Any] = {
        'artist': song.get('artist') or 'Unknown',
        'title': song.get('title') or 'Unknown',
        'score': song.get('score') or 0,
    }
    for key in ('album', 'isrc', 'timecode'):
        if song.get(key) is not None:
            match[key] = song[key]
    if offset_ms is not None:
        match['offset_ms'] = offset_ms
    return match


def _offset_ms(offset: object) -> int | None:
    if isinstance(offset, bool):
        return None
    if isinstance(offset, int):
        return offset
    if not isinstance(offset, str):
        return None
    try:
        parts = [int(p) for p in offset.split(':')]
    except ValueError:
        return None
    if len(parts) == 2:
        return (parts[0] * 60 + parts[1]) * 1000
    if len(parts) == 3:
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    return None


class Unconfigured:
    def matches(self, audio_url: str, plan: ScanPlan) -> list[dict[str, Any]]:
        raise RuntimeError('no fingerprinter configured')
