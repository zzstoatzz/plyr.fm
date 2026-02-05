"""CLAP embedding service client.

client for generating audio and text embeddings via Modal-hosted CLAP model.
used for semantic vibe search (text-to-audio matching).
"""

import base64
import logging
from dataclasses import dataclass
from typing import Self

import httpx
import logfire

from backend.config import settings

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingResult:
    """result from an embedding operation."""

    success: bool
    embedding: list[float] | None
    dimensions: int | None
    error: str | None = None


class ClapClient:
    """client for the Modal-hosted CLAP embedding service.

    CLAP (Contrastive Language-Audio Pretraining) generates embeddings
    in a shared space for both audio and text, enabling semantic search.

    usage:
        client = ClapClient.from_settings()
        result = await client.embed_audio(audio_bytes)
        result = await client.embed_text("dark ambient techno")
    """

    def __init__(
        self,
        embed_audio_url: str,
        embed_text_url: str,
        timeout_seconds: float | int,
    ) -> None:
        self.embed_audio_url = embed_audio_url.rstrip("/")
        self.embed_text_url = embed_text_url.rstrip("/")
        self.timeout = httpx.Timeout(timeout_seconds)

    @classmethod
    def from_settings(cls) -> Self:
        """create a client from application settings."""
        return cls(
            embed_audio_url=settings.modal.embed_audio_url,
            embed_text_url=settings.modal.embed_text_url,
            timeout_seconds=settings.modal.timeout_seconds,
        )

    async def embed_audio(self, audio_bytes: bytes) -> EmbeddingResult:
        """generate an embedding from audio bytes.

        args:
            audio_bytes: raw audio file bytes

        returns:
            EmbeddingResult with 512-dim embedding or error
        """
        b64_audio = base64.b64encode(audio_bytes).decode("utf-8")

        logfire.info(
            "requesting audio embedding",
            audio_size_kb=len(audio_bytes) / 1024,
        )

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.embed_audio_url,
                    json={"audio_b64": b64_audio},
                )
                response.raise_for_status()

                data = response.json()
                embedding = data["embedding"]

                logfire.info(
                    "audio embedding generated",
                    dimensions=len(embedding),
                )

                return EmbeddingResult(
                    success=True,
                    embedding=embedding,
                    dimensions=len(embedding),
                )

        except httpx.TimeoutException as e:
            logger.error("audio embedding timed out: %s", e)
            return EmbeddingResult(
                success=False,
                embedding=None,
                dimensions=None,
                error=f"embedding timed out after {self.timeout.read}s",
            )

        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if e.response.text else "no body"
            logger.error(
                "audio embedding failed: %s - %s",
                e.response.status_code,
                error_body,
            )
            return EmbeddingResult(
                success=False,
                embedding=None,
                dimensions=None,
                error=f"embedding service returned {e.response.status_code}: {error_body}",
            )

        except Exception as e:
            logger.exception("unexpected error during audio embedding")
            return EmbeddingResult(
                success=False,
                embedding=None,
                dimensions=None,
                error=f"unexpected error: {e}",
            )

    async def embed_text(self, text: str) -> EmbeddingResult:
        """generate an embedding from text.

        args:
            text: description text (e.g. "dark ambient techno")

        returns:
            EmbeddingResult with 512-dim embedding or error
        """
        logfire.info("requesting text embedding", text=text)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.embed_text_url,
                    json={"text": text},
                )
                response.raise_for_status()

                data = response.json()
                embedding = data["embedding"]

                logfire.info(
                    "text embedding generated",
                    dimensions=len(embedding),
                )

                return EmbeddingResult(
                    success=True,
                    embedding=embedding,
                    dimensions=len(embedding),
                )

        except httpx.TimeoutException as e:
            logger.error("text embedding timed out: %s", e)
            return EmbeddingResult(
                success=False,
                embedding=None,
                dimensions=None,
                error=f"embedding timed out after {self.timeout.read}s",
            )

        except httpx.HTTPStatusError as e:
            error_body = e.response.text[:500] if e.response.text else "no body"
            logger.error(
                "text embedding failed: %s - %s",
                e.response.status_code,
                error_body,
            )
            return EmbeddingResult(
                success=False,
                embedding=None,
                dimensions=None,
                error=f"embedding service returned {e.response.status_code}: {error_body}",
            )

        except Exception as e:
            logger.exception("unexpected error during text embedding")
            return EmbeddingResult(
                success=False,
                embedding=None,
                dimensions=None,
                error=f"unexpected error: {e}",
            )


# module-level singleton
_client: ClapClient | None = None


def get_clap_client() -> ClapClient:
    """get the CLAP client singleton.

    creates the client on first call, reuses on subsequent calls.
    """
    global _client
    if _client is None:
        _client = ClapClient.from_settings()
    return _client
