"""cover art moderation: Claude looks at a cover against plyr's image policy,
the check prod runs on every cover uploaded to it (prod's prompt and schema,
from services/moderation/src/claude.rs). next asks Claude itself rather than
through prod's moderation service. a flag here only opens a review in next's
queue.
"""

import base64
import io
import json
from dataclasses import dataclass
from typing import Protocol

import anthropic
import requests
from PIL import Image

MAX_IMAGE_BYTES = 10_000_000
# what the image check takes as is: a small upload, and Claude looks at no more
# than 1568px a side
SEND_BYTES = 1_500_000
SEND_EDGE = 1568
SEND_TYPES = ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
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


def fetch_url(image_url: str) -> str:
    """next's cover worker serves a bounded webp at &w=1280; anything else as named."""
    if image_url.startswith(NEXT_IMAGES):
        return image_url + ('&' if '?' in image_url else '?') + 'w=1280'
    return image_url


def fetch(image_url: str) -> tuple[bytes, str]:
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
    return body, media_type


PROMPT = """You are a content moderator for a music streaming platform. Analyze the provided image (album/track cover art) for policy violations.

Check for:
1. Explicit sexual content (nudity, pornography)
2. Extreme violence or gore
3. Hate symbols or content
4. Illegal content
5. Graphic drug use imagery

Note: Artistic nudity in album art (like classic rock covers) may be acceptable if not explicit/pornographic.

Analyze the image and provide your moderation decision."""

SCHEMA = {
    'type': 'object',
    'properties': {
        'is_safe': {'type': 'boolean', 'description': 'Whether the image passes moderation'},
        'violated_categories': {
            'type': 'array',
            'items': {'type': 'string'},
            'description': 'List of policy categories violated, empty if safe',
        },
        'severity': {
            'type': 'string',
            'enum': ['safe', 'low', 'medium', 'high'],
            'description': 'Severity level of the violation',
        },
        'explanation': {'type': 'string', 'description': 'Brief explanation of the moderation decision'},
    },
    'required': ['is_safe', 'violated_categories', 'severity', 'explanation'],
    'additionalProperties': False,
}

# the model prod's check runs on
MODEL = 'claude-sonnet-5-5'


def verdict_from(message: anthropic.types.beta.BetaMessage) -> Verdict:
    """a refusal or a cut-off answer is a failed scan, never a clean one."""
    if message.stop_reason != 'end_turn':
        raise RuntimeError(f'image check stopped: {message.stop_reason}')
    text = next((block.text for block in message.content if block.type == 'text'), None)
    if text is None:
        raise TypeError('image check answered no text')
    answer = json.loads(text)
    return Verdict(
        is_safe=bool(answer['is_safe']),
        severity=str(answer['severity']),
        categories=[str(c) for c in answer['violated_categories']],
        reason=str(answer['explanation']),
    )


class ClaudeImageScanner:
    def __init__(self, client: anthropic.Anthropic, model: str = MODEL) -> None:
        self._client = client
        self._model = model

    def verdict(self, image_url: str) -> Verdict:
        body, media_type = sendable(*fetch(image_url))
        message = self._client.beta.messages.create(
            model=self._model,
            max_tokens=4096,
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
            output_config={'effort': 'low', 'format': {'type': 'json_schema', 'schema': SCHEMA}},
            messages=[
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': PROMPT},
                        {
                            'type': 'image',
                            'source': {
                                'type': 'base64',
                                'media_type': media_type,
                                'data': base64.standard_b64encode(body).decode('ascii'),
                            },
                        },
                    ],
                }
            ],
        )
        return verdict_from(message)


def sendable(body: bytes, media_type: str) -> tuple[bytes, str]:
    """the image as the check can take it: a cover over the size, past 1568px or in
    a format Claude doesn't read is sent as a JPEG of at most 1568px a side."""
    if media_type in SEND_TYPES and len(body) <= SEND_BYTES:
        with Image.open(io.BytesIO(body)) as image:
            if max(image.size) <= SEND_EDGE:
                return body, media_type
    with Image.open(io.BytesIO(body)) as image:
        image.seek(0)
        image.thumbnail((SEND_EDGE, SEND_EDGE))
        if image.mode in ('RGBA', 'LA', 'P'):
            image = image.convert('RGBA')
            flat = Image.new('RGB', image.size, 'white')
            flat.paste(image, mask=image.getchannel('A'))
            image = flat
        else:
            image = image.convert('RGB')
        out = io.BytesIO()
        image.save(out, 'JPEG', quality=85)
    return out.getvalue(), 'image/jpeg'


class Unconfigured:
    def verdict(self, image_url: str) -> Verdict:
        raise RuntimeError('no image scanner configured')
