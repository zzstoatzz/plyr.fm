"""replicate genre classification client.

client for classifying track genres via the effnet-discogs model on Replicate.
uses the Replicate HTTP API directly (SDK incompatible with Python 3.14).
"""

import logging
from dataclasses import dataclass, field
from typing import Self

import httpx
import logfire

from backend.config import settings

logger = logging.getLogger(__name__)

REPLICATE_API_BASE = "https://api.replicate.com/v1"
EFFNET_DISCOGS_VERSION = (
    "1532dd069fb4f0e27c6833e28815f6b8c194dfec76fd9cd73460540fd720ffe1"
)


@dataclass
class GenrePrediction:
    """a single genre prediction with confidence score."""

    name: str
    confidence: float


@dataclass
class ClassificationResult:
    """result from a genre classification operation."""

    success: bool
    genres: list[GenrePrediction] = field(default_factory=list)
    error: str | None = None


def _split_genre_name(raw: str) -> list[str]:
    """split Discogs taxonomy names like 'Electronic---Ambient' into separate tags.

    the effnet-discogs model returns genre/subgenre pairs separated by '---'.
    we split them into individual lowercase tags for more useful categorization.
    e.g. 'Electronic---Deep Techno' → ['electronic', 'deep techno']
    """
    if "---" in raw:
        genre, subgenre = raw.split("---", 1)
        return [genre.lower(), subgenre.lower()]
    return [raw.lower()]


class ReplicateClient:
    """client for genre classification via Replicate's effnet-discogs model.

    usage:
        client = ReplicateClient.from_settings()
        result = await client.classify(audio_url)
    """

    def __init__(
        self,
        api_token: str,
        top_n: int,
        timeout_seconds: float | int,
    ) -> None:
        self.api_token = api_token
        self.top_n = top_n
        self.timeout = httpx.Timeout(timeout_seconds)

    @classmethod
    def from_settings(cls) -> Self:
        """create a client from application settings."""
        return cls(
            api_token=settings.replicate.api_token.get_secret_value(),
            top_n=settings.replicate.top_n,
            timeout_seconds=settings.replicate.timeout_seconds,
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
            "Prefer": "wait",
        }

    async def classify(self, audio_url: str) -> ClassificationResult:
        """classify genres for an audio file.

        args:
            audio_url: public URL of the audio file

        returns:
            ClassificationResult with genre predictions or error
        """
        payload = {
            "version": EFFNET_DISCOGS_VERSION,
            "input": {
                "audio": audio_url,
                "top_n": self.top_n,
                "output_format": "JSON",
            },
        }

        logfire.info(
            "requesting genre classification",
            audio_url=audio_url,
            top_n=self.top_n,
        )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # create prediction (Prefer: wait blocks until complete)
                response = await client.post(
                    f"{REPLICATE_API_BASE}/predictions",
                    headers=self._headers(),
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()

                status = data.get("status")
                if status == "failed":
                    error = data.get("error", "unknown error")
                    logger.error("replicate prediction failed: %s", error)
                    return ClassificationResult(
                        success=False,
                        error=f"prediction failed: {error}",
                    )

                if status != "succeeded":
                    # shouldn't happen with Prefer: wait, but handle gracefully
                    logger.warning(
                        "replicate prediction not complete: status=%s", status
                    )
                    return ClassificationResult(
                        success=False,
                        error=f"prediction not complete: status={status}",
                    )

                output_url = data.get("output")
                if not output_url:
                    return ClassificationResult(
                        success=False,
                        error="no output URL in prediction response",
                    )

                # fetch the output JSON
                output_response = await client.get(output_url)
                output_response.raise_for_status()
                predictions = output_response.json()

                # split genre/subgenre pairs and deduplicate, keeping highest score
                seen: dict[str, float] = {}
                for name, score in predictions.items():
                    for tag in _split_genre_name(name):
                        if tag not in seen or score > seen[tag]:
                            seen[tag] = round(score, 4)

                genres = [
                    GenrePrediction(name=tag, confidence=conf)
                    for tag, conf in seen.items()
                ]
                # sort by confidence descending
                genres.sort(key=lambda g: g.confidence, reverse=True)

                logfire.info(
                    "genre classification complete",
                    genre_count=len(genres),
                    top_genre=genres[0].name if genres else None,
                )

                return ClassificationResult(success=True, genres=genres)

        except httpx.TimeoutException as e:
            logger.error("genre classification timed out: %s", e)
            return ClassificationResult(
                success=False,
                error=f"classification timed out after {self.timeout.read}s",
            )

        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if e.response.text else "no body"
            logger.error(
                "genre classification failed: %s - %s",
                e.response.status_code,
                error_body,
            )
            return ClassificationResult(
                success=False,
                error=f"replicate API returned {e.response.status_code}: {error_body}",
            )

        except Exception as e:
            logger.exception("unexpected error during genre classification")
            return ClassificationResult(
                success=False,
                error=f"unexpected error: {e}",
            )


# module-level singleton
_client: ReplicateClient | None = None


def get_replicate_client() -> ReplicateClient:
    """get the Replicate client singleton.

    creates the client on first call, reuses on subsequent calls.
    """
    global _client
    if _client is None:
        _client = ReplicateClient.from_settings()
    return _client
