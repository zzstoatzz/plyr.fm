"""turbopuffer vector database client.

client for storing and querying CLAP embeddings in turbopuffer.
used for semantic vibe search (text-to-audio matching).
"""

import logging
from dataclasses import dataclass

import logfire
from turbopuffer import AsyncTurbopuffer

from backend.config import settings

logger = logging.getLogger(__name__)


@dataclass
class VectorSearchResult:
    """a single result from a vector similarity query."""

    track_id: int
    distance: float
    title: str | None = None
    artist_handle: str | None = None
    artist_did: str | None = None


async def upsert(
    track_id: int,
    embedding: list[float],
    title: str,
    artist_handle: str,
    artist_did: str,
) -> None:
    """upsert a track embedding into turbopuffer.

    args:
        track_id: database ID of the track
        embedding: CLAP embedding vector (512-dim)
        title: track title (stored as attribute for debugging)
        artist_handle: artist handle
        artist_did: artist DID
    """
    async with AsyncTurbopuffer(
        api_key=settings.turbopuffer.api_key.get_secret_value(),
        region=settings.turbopuffer.region,
    ) as client:
        ns = client.namespace(settings.turbopuffer.namespace)
        row: dict[str, object] = {
            "id": track_id,
            "vector": embedding,
            "title": title,
            "artist_handle": artist_handle,
            "artist_did": artist_did,
        }
        await ns.write(
            upsert_rows=[row],
            distance_metric="cosine_distance",
        )
        logfire.info("upserted track embedding", track_id=track_id)


async def query(
    embedding: list[float],
    top_k: int = 10,
) -> list[VectorSearchResult]:
    """query turbopuffer for similar tracks.

    args:
        embedding: query embedding vector (from text or audio)
        top_k: number of results to return

    returns:
        list of VectorSearchResult sorted by similarity
    """
    async with AsyncTurbopuffer(
        api_key=settings.turbopuffer.api_key.get_secret_value(),
        region=settings.turbopuffer.region,
    ) as client:
        ns = client.namespace(settings.turbopuffer.namespace)
        response = await ns.query(
            rank_by=("vector", "ANN", embedding),
            top_k=top_k,
            include_attributes=["title", "artist_handle", "artist_did"],
        )

        results: list[VectorSearchResult] = []
        for row in response.rows or []:
            title = row["title"]
            artist_handle = row["artist_handle"]
            artist_did = row["artist_did"]
            results.append(
                VectorSearchResult(
                    track_id=int(row.id),
                    distance=row["$dist"],
                    title=str(title) if title else None,
                    artist_handle=str(artist_handle) if artist_handle else None,
                    artist_did=str(artist_did) if artist_did else None,
                )
            )

        logfire.info("vector query returned {count} results", count=len(results))
        return results


async def delete(track_id: int) -> None:
    """delete a track embedding from turbopuffer.

    args:
        track_id: database ID of the track to remove
    """
    async with AsyncTurbopuffer(
        api_key=settings.turbopuffer.api_key.get_secret_value(),
        region=settings.turbopuffer.region,
    ) as client:
        ns = client.namespace(settings.turbopuffer.namespace)
        await ns.write(deletes=[track_id])
        logfire.info("deleted track embedding", track_id=track_id)
