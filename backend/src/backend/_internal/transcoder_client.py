"""transcoder service client.

client for converting non-web-playable audio formats (AIFF, FLAC) to MP3.
"""

import logging
from dataclasses import dataclass

import httpx
import logfire

from backend.config import settings

logger = logging.getLogger(__name__)


@dataclass
class TranscodeResult:
    """result from a transcode operation."""

    success: bool
    data: bytes | None
    content_type: str | None
    error: str | None = None


class TranscoderClient:
    """client for the plyr.fm transcoder service.

    the transcoder is a standalone Rust service that uses ffmpeg to convert
    lossless formats (AIFF, FLAC) to web-playable MP3.

    usage:
        client = TranscoderClient.from_settings()
        result = await client.transcode(audio_bytes, "track.aiff", "aiff")
    """

    def __init__(
        self,
        service_url: str,
        auth_token: str,
        timeout_seconds: float | int,
        target_format: str,
    ) -> None:
        self.service_url = service_url.rstrip("/")
        self.auth_token = auth_token
        self.timeout = httpx.Timeout(timeout_seconds)
        self.target_format = target_format

    @classmethod
    def from_settings(cls) -> "TranscoderClient":
        """create a client from application settings."""
        return cls(
            service_url=settings.transcoder.service_url,
            auth_token=settings.transcoder.auth_token,
            timeout_seconds=settings.transcoder.timeout_seconds,
            target_format=settings.transcoder.target_format,
        )

    def _headers(self) -> dict[str, str]:
        """common auth headers."""
        return {"X-Transcoder-Key": self.auth_token}

    async def transcode(
        self,
        audio_data: bytes,
        filename: str,
        source_format: str,
        target_format: str | None = None,
    ) -> TranscodeResult:
        """transcode audio to a web-playable format.

        args:
            audio_data: raw audio file bytes
            filename: original filename (used for logging)
            source_format: source format (e.g., "aiff", "flac")
            target_format: target format (defaults to settings.transcoder.target_format)

        returns:
            TranscodeResult with transcoded bytes or error

        note:
            this operation can take 5-30+ seconds depending on file size.
            the timeout is set high (10 min) to accommodate large files.
        """
        target = target_format or self.target_format

        logfire.info(
            "starting transcode",
            filename=filename,
            source_format=source_format,
            target_format=target,
            size_mb=len(audio_data) / (1024 * 1024),
        )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.service_url}/transcode",
                    files={"file": (filename, audio_data, f"audio/{source_format}")},
                    params={"target": target},
                    headers=self._headers(),
                )
                response.raise_for_status()

                logfire.info(
                    "transcode completed",
                    filename=filename,
                    source_format=source_format,
                    target_format=target,
                    output_size_mb=len(response.content) / (1024 * 1024),
                )

                return TranscodeResult(
                    success=True,
                    data=response.content,
                    content_type=response.headers.get("content-type"),
                )

        except httpx.TimeoutException as e:
            logger.error("transcode timed out for %s: %s", filename, e)
            return TranscodeResult(
                success=False,
                data=None,
                content_type=None,
                error=f"transcode timed out after {self.timeout.read}s",
            )

        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if e.response.text else "no body"
            logger.error(
                "transcode failed for %s: %s - %s",
                filename,
                e.response.status_code,
                error_body,
            )
            return TranscodeResult(
                success=False,
                data=None,
                content_type=None,
                error=f"transcode service returned {e.response.status_code}: {error_body}",
            )

        except Exception as e:
            logger.exception("unexpected error during transcode for %s", filename)
            return TranscodeResult(
                success=False,
                data=None,
                content_type=None,
                error=f"unexpected error: {e}",
            )


# module-level singleton
_client: TranscoderClient | None = None


def get_transcoder_client() -> TranscoderClient:
    """get the transcoder client singleton.

    creates the client on first call, reuses on subsequent calls.
    """
    global _client
    if _client is None:
        _client = TranscoderClient.from_settings()
    return _client
