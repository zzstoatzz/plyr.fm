"""audio streaming endpoint."""

import logfire
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import or_, select

from backend._internal import Session, get_optional_session, validate_supporter
from backend.models import Track
from backend.storage import storage
from backend.utilities.database import db_session

router = APIRouter(prefix="/audio", tags=["audio"])


class AudioUrlResponse(BaseModel):
    """response containing direct R2 URL for offline caching."""

    url: str
    file_id: str
    file_type: str | None


@router.head("/{file_id}")
@router.get("/{file_id}")
async def stream_audio(
    file_id: str,
    request: Request,
    session: Session | None = Depends(get_optional_session),
):
    """stream audio file by redirecting to R2 CDN URL.

    for public tracks: redirects to R2 CDN URL.
    for gated tracks: validates supporter status and returns presigned URL.

    HEAD requests are used for pre-flight auth checks - they return
    200/401/402 status without redirecting to avoid CORS issues.

    images are served directly via R2 URLs stored in the image_url field,
    not through this endpoint.
    """
    is_head_request = request.method == "HEAD"
    # look up track - could be by file_id (transcoded) or original_file_id (lossless)
    async with db_session() as db:
        result = await db.execute(
            select(
                Track.file_id,
                Track.r2_url,
                Track.file_type,
                Track.original_file_id,
                Track.original_file_type,
                Track.support_gate,
                Track.artist_did,
            )
            .where(or_(Track.file_id == file_id, Track.original_file_id == file_id))
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        track_data = result.first()

        if not track_data:
            raise HTTPException(status_code=404, detail="audio file not found")

        (
            track_file_id,
            r2_url,
            file_type,
            original_file_id,
            original_file_type,
            support_gate,
            artist_did,
        ) = track_data

    # determine if we're serving the original lossless file
    serving_original = file_id == original_file_id and original_file_type is not None
    serve_file_id = file_id if serving_original else track_file_id
    serve_file_type = original_file_type if serving_original else file_type

    # check if track is gated
    if support_gate is not None:
        return await _handle_gated_audio(
            file_id=serve_file_id,
            file_type=serve_file_type,
            artist_did=artist_did,
            session=session,
            is_head_request=is_head_request,
        )

    # public track - use cached r2_url only for transcoded version
    if not serving_original and r2_url and r2_url.startswith("http"):
        return RedirectResponse(url=r2_url)

    # get URL for the requested file (original or transcoded)
    url = await storage.get_url(
        serve_file_id, file_type="audio", extension=serve_file_type
    )
    if not url:
        raise HTTPException(status_code=404, detail="audio file not found")
    return RedirectResponse(url=url)


async def _handle_gated_audio(
    file_id: str,
    file_type: str,
    artist_did: str,
    session: Session | None,
    is_head_request: bool = False,
) -> RedirectResponse | Response:
    """handle streaming for supporter-gated content.

    validates that the user is authenticated and either:
    - is the artist who uploaded the track, OR
    - supports the artist via atprotofans
    before returning a presigned URL for the private bucket.

    for HEAD requests (used for pre-flight auth checks), returns 200 status
    without redirecting to avoid CORS issues with cross-origin redirects.
    """
    # must be authenticated to access gated content
    if not session:
        raise HTTPException(
            status_code=401,
            detail="authentication required for supporter-gated content",
        )

    # artist can always play their own gated tracks
    if session.did == artist_did:
        logfire.info(
            "serving gated content to owner",
            file_id=file_id,
            artist_did=artist_did,
        )
    else:
        # validate supporter status via atprotofans
        validation = await validate_supporter(
            supporter_did=session.did,
            artist_did=artist_did,
        )

        if not validation.valid:
            raise HTTPException(
                status_code=402,
                detail="this track requires supporter access",
                headers={"X-Support-Required": "true"},
            )

    # for HEAD requests, just return 200 to confirm access
    # (avoids CORS issues with cross-origin redirects)
    if is_head_request:
        return Response(status_code=200)

    # authorized - generate presigned URL for private bucket
    if session.did != artist_did:
        logfire.info(
            "serving gated content to supporter",
            file_id=file_id,
            supporter_did=session.did,
            artist_did=artist_did,
        )

    url = await storage.generate_presigned_url(file_id=file_id, extension=file_type)
    return RedirectResponse(url=url)


@router.get("/{file_id}/url")
async def get_audio_url(
    file_id: str,
    session: Session | None = Depends(get_optional_session),
) -> AudioUrlResponse:
    """return direct URL for audio file.

    for public tracks: returns R2 CDN URL for offline caching.
    for gated tracks: returns presigned URL after supporter validation.

    used for offline mode - frontend fetches and caches locally.
    """
    async with db_session() as db:
        result = await db.execute(
            select(
                Track.file_id,
                Track.r2_url,
                Track.file_type,
                Track.original_file_id,
                Track.original_file_type,
                Track.support_gate,
                Track.artist_did,
            )
            .where(or_(Track.file_id == file_id, Track.original_file_id == file_id))
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        track_data = result.first()

        if not track_data:
            raise HTTPException(status_code=404, detail="audio file not found")

        (
            track_file_id,
            r2_url,
            file_type,
            original_file_id,
            original_file_type,
            support_gate,
            artist_did,
        ) = track_data

    # determine if we're serving the original lossless file
    serving_original = file_id == original_file_id and original_file_type is not None
    serve_file_id = file_id if serving_original else track_file_id
    serve_file_type = original_file_type if serving_original else file_type

    # check if track is gated
    if support_gate is not None:
        # must be authenticated
        if not session:
            raise HTTPException(
                status_code=401,
                detail="authentication required for supporter-gated content",
            )

        # artist can always access their own gated tracks
        if session.did != artist_did:
            # validate supporter status
            validation = await validate_supporter(
                supporter_did=session.did,
                artist_did=artist_did,
            )

            if not validation.valid:
                raise HTTPException(
                    status_code=402,
                    detail="this track requires supporter access",
                    headers={"X-Support-Required": "true"},
                )

        # return presigned URL
        url = await storage.generate_presigned_url(
            file_id=serve_file_id, extension=serve_file_type
        )
        return AudioUrlResponse(
            url=url, file_id=serve_file_id, file_type=serve_file_type
        )

    # public track - return cached r2_url only for transcoded version
    if not serving_original and r2_url and r2_url.startswith("http"):
        return AudioUrlResponse(
            url=r2_url, file_id=serve_file_id, file_type=serve_file_type
        )

    # otherwise, resolve it
    url = await storage.get_url(
        serve_file_id, file_type="audio", extension=serve_file_type
    )
    if not url:
        raise HTTPException(status_code=404, detail="audio file not found")

    return AudioUrlResponse(url=url, file_id=serve_file_id, file_type=serve_file_type)
