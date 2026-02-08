"""ML background tasks (embeddings, genre classification)."""

import logging

import httpx
import logfire
from sqlalchemy import select

from backend._internal.background import get_docket
from backend._internal.clients.clap import get_clap_client
from backend._internal.clients.tpuf import upsert as tpuf_upsert
from backend.config import settings
from backend.models import Artist, Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def generate_embedding(track_id: int, audio_url: str) -> None:
    """generate a CLAP embedding for a track and store in turbopuffer.

    args:
        track_id: database ID of the track
        audio_url: public URL of the audio file (R2)
    """
    if not (settings.modal.enabled and settings.turbopuffer.enabled):
        logger.debug("embedding generation disabled, skipping track %d", track_id)
        return

    async with db_session() as db:
        result = await db.execute(
            select(Track)
            .join(Artist, Track.artist_did == Artist.did)
            .where(Track.id == track_id)
        )
        row = result.first()
        if not row:
            logger.warning("generate_embedding: track %d not found", track_id)
            return

        track = row[0]

        artist_result = await db.execute(
            select(Artist).where(Artist.did == track.artist_did)
        )
        artist = artist_result.scalar_one_or_none()
        if not artist:
            logger.warning(
                "generate_embedding: artist not found for track %d", track_id
            )
            return

    # download audio from R2
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        resp = await client.get(audio_url)
        resp.raise_for_status()
        audio_bytes = resp.content

    # generate embedding via CLAP
    clap_client = get_clap_client()
    embed_result = await clap_client.embed_audio(audio_bytes)

    if not embed_result.success or not embed_result.embedding:
        logger.error(
            "generate_embedding: CLAP embedding failed for track %d: %s",
            track_id,
            embed_result.error,
        )
        return

    # store in turbopuffer
    await tpuf_upsert(
        track_id=track_id,
        embedding=embed_result.embedding,
        title=track.title,
        artist_handle=artist.handle,
        artist_did=artist.did,
    )

    logfire.info("generated embedding for track", track_id=track_id)


async def schedule_embedding_generation(track_id: int, audio_url: str) -> None:
    """schedule an embedding generation via docket."""
    docket = get_docket()
    await docket.add(generate_embedding)(track_id, audio_url)
    logfire.info("scheduled embedding generation", track_id=track_id)


async def classify_genres(track_id: int, audio_url: str) -> None:
    """classify genres for a track via Replicate effnet-discogs and store results.

    args:
        track_id: database ID of the track
        audio_url: public URL of the audio file (R2)
    """
    from backend._internal.clients.replicate import get_replicate_client

    if not settings.replicate.enabled:
        logger.debug("genre classification disabled, skipping track %d", track_id)
        return

    client = get_replicate_client()
    result = await client.classify(audio_url)

    if not result.success:
        logger.error(
            "genre classification failed for track %d: %s",
            track_id,
            result.error,
        )
        return

    predictions = [{"name": g.name, "confidence": g.confidence} for g in result.genres]

    async with db_session() as db:
        db_result = await db.execute(select(Track).where(Track.id == track_id))
        track = db_result.scalar_one_or_none()
        if not track:
            logger.warning("classify_genres: track %d not found", track_id)
            return

        extra = dict(track.extra) if track.extra else {}
        extra["genre_predictions"] = predictions
        extra["genre_predictions_file_id"] = track.file_id

        # auto-tag if requested
        if extra.get("auto_tag") and predictions:
            from backend.utilities.tags import add_tags_to_track

            # ratio-to-top: keep tags scoring >= 50% of top score
            top_confidence = float(predictions[0]["confidence"])
            top_tags = [
                str(p["name"])
                for p in predictions
                if float(p["confidence"]) >= top_confidence * 0.5
            ][:5]  # cap at 5

            if top_tags:
                await add_tags_to_track(db, track_id, top_tags, track.artist_did)
                logfire.info(
                    "auto-tagged track",
                    track_id=track_id,
                    tags=top_tags,
                )

            # clean up flag
            del extra["auto_tag"]

        track.extra = extra
        await db.commit()

    logfire.info(
        "classified genres for track",
        track_id=track_id,
        top_genre=predictions[0]["name"] if predictions else None,
    )


async def schedule_genre_classification(track_id: int, audio_url: str) -> None:
    """schedule a genre classification via docket."""
    docket = get_docket()
    await docket.add(classify_genres)(track_id, audio_url)
    logfire.info("scheduled genre classification", track_id=track_id)
