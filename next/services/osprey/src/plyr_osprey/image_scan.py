"""cover art moderation through plyr's moderation service, the scan prod runs on
every cover uploaded to it.

`POST {base}/scan-image` (multipart `image`, `image_id`) has Claude look at the
image against plyr's image policy (services/moderation/src/claude.rs) and
answers `{is_safe, reason, severity, violated_categories}`. the service also
keeps its own record of the scan (cost tracking and prod's sensitive-image
list, keyed by image_id); next's ids are prefixed `next:` so they never name a
prod image. a flag here only opens a review in next's queue.
"""

import hashlib
from dataclasses import dataclass
from typing import Protocol

import requests

MAX_IMAGE_BYTES = 10_000_000
# next's cover worker (next/services/audio/src/images.ts): copies a cover off its
# PDS, keeps it only if it hashes to the CID, and serves it sized with &w=
NEXT_IMAGES = 'https://plyr-next-audio.n8-3e9.workers.dev/images/'
USER_AGENT = 'plyr.fm-next-osprey/0.1 (+https://plyr.fm)'


@dataclass(frozen=True)
class Verdict:
    is_safe: bool
    severity: str
    categories: list[str]
    reason: str

    def describe(self) -> str:
        categories = ', '.join(self.categories) or 'policy'
        return f'{self.severity}: {categories}: {self.reason}'.strip(': ')


class ImageScanner(Protocol):
    def verdict(self, image_url: str) -> Verdict: ...


def image_id(image_url: str) -> str:
    if image_url.startswith(NEXT_IMAGES):
        return 'next:' + image_url[len(NEXT_IMAGES) :].split('?', 1)[0]
    return 'next:url:' + hashlib.sha256(image_url.encode()).hexdigest()[:32]


def fetch_url(image_url: str) -> str:
    """next's cover worker serves a bounded webp at &w=1280; anything else as named."""
    if image_url.startswith(NEXT_IMAGES):
        return image_url + ('&' if '?' in image_url else '?') + 'w=1280'
    return image_url


class ModerationServiceImageScanner:
    def __init__(self, base_url: str, auth_token: str, timeout_seconds: float = 120.0) -> None:
        self._url = base_url.rstrip('/') + '/scan-image'
        self._headers = {'X-Moderation-Key': auth_token, 'User-Agent': USER_AGENT}
        self._timeout = timeout_seconds

    def verdict(self, image_url: str) -> Verdict:
        with requests.get(
            fetch_url(image_url), headers={'User-Agent': USER_AGENT}, timeout=30, stream=True, allow_redirects=False
        ) as image:
            image.raise_for_status()
            media_type = image.headers.get('content-type', '').split(';', 1)[0].strip()
            if not media_type.startswith('image/'):
                raise ValueError(f'{image_url} is not an image ({media_type or "no content type"})')
            body = image.raw.read(MAX_IMAGE_BYTES + 1, decode_content=True)
        if len(body) > MAX_IMAGE_BYTES:
            raise ValueError(f'{image_url} is over {MAX_IMAGE_BYTES} bytes')
        response = requests.post(
            self._url,
            files={'image': ('cover', body, media_type)},
            data={'image_id': image_id(image_url)},
            headers=self._headers,
            timeout=self._timeout,
        )
        response.raise_for_status()
        answer = response.json()
        if not isinstance(answer, dict) or not isinstance(answer.get('is_safe'), bool):
            raise TypeError('scan-image response has no is_safe')
        categories = answer.get('violated_categories') or []
        return Verdict(
            is_safe=answer['is_safe'],
            severity=str(answer.get('severity') or ''),
            categories=[str(c) for c in categories] if isinstance(categories, list) else [],
            reason=str(answer.get('reason') or ''),
        )


class Unconfigured:
    def verdict(self, image_url: str) -> Verdict:
        raise RuntimeError('no image scanner configured')
