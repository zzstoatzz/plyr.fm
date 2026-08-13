"""audio streaming endpoint."""

import logfire
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_, select

from backend._internal import Session, get_optional_session, validate_supporter
from backend._internal.atproto.client import pds_blob_url
from backend._internal.atproto.spaces.client import SpaceAccessError, open_space_blob
from backend.config import settings
from backend.models import Artist, Track, UserPreferences
from backend.storage import storage
from backend.utilities.database import db_session
from backend.utilities.downloads import (
    download_filename,
    download_key,
    download_refusal,
)

# headers worth relaying from the upstream getBlob response so range/seek works
_PROXY_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges")

router = APIRouter(prefix="/audio", tags=["audio"])


async def _resolve_pds_url(artist_did: str) -> str | None:
    """look up the cached PDS URL for an artist."""
    async with db_session() as db:
        result = await db.execute(
            select(Artist.pds_url).where(Artist.did == artist_did).limit(1)
        )
        return result.scalar_one_or_none()


class AudioUrlResponse(BaseModel):
    """response containing direct R2 URL for offline caching."""

    url: str
    file_id: str
    file_type: str | None


# Content labels no longer gate audio bytes. Adult labels are a rendering
# default for shared surfaces (see content_labels.may_stream_sensitive_audio),
# and a copyright label removes a track from discovery and radio rather than
# from its own permalink. Dropping the check also removes a strict labeler
# round trip -- and its 503 failure mode -- from every audio request.


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
                Track.audio_storage,
                Track.pds_blob_cid,
                Track.is_private,
                Track.space_uri,
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
            audio_storage,
            pds_blob_cid,
            is_private,
            space_uri,
        ) = track_data

    # private media lives in a permissioned space — proxy the bytes through the
    # owner's space credential (can't redirect: the browser has no credential).
    if is_private:
        return await _handle_private_audio(
            session=session,
            artist_did=artist_did,
            space_uri=space_uri,
            pds_blob_cid=pds_blob_cid,
            request=request,
            is_head_request=is_head_request,
        )

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
            support_gate=support_gate,
            is_head_request=is_head_request,
            audio_storage=audio_storage,
            pds_blob_cid=pds_blob_cid,
        )

    # public track - use cached r2_url only for transcoded version
    if not serving_original and r2_url and r2_url.startswith("http"):
        return RedirectResponse(url=r2_url)

    # PDS-only tracks: redirect to PDS getBlob endpoint
    if audio_storage == "pds" and pds_blob_cid and not r2_url:
        if artist_pds_url := await _resolve_pds_url(artist_did):
            return RedirectResponse(
                url=pds_blob_url(artist_pds_url, artist_did, pds_blob_cid)
            )

    # get URL for the requested file (original or transcoded)
    if url := await storage.get_url(
        serve_file_id, file_type="audio", extension=serve_file_type
    ):
        return RedirectResponse(url=url)

    # R2 has nothing. For anything we mirrored, the artist's own PDS holds a
    # copy that is by definition still theirs — serve it rather than 404. Since
    # #1732 deleted R2 objects out from under published tracks, a missing bucket
    # copy is our failure, not evidence the audio is gone.
    if pds_blob_cid and (artist_pds_url := await _resolve_pds_url(artist_did)):
        return RedirectResponse(
            url=pds_blob_url(artist_pds_url, artist_did, pds_blob_cid)
        )

    raise HTTPException(status_code=404, detail="audio file not found")


async def _check_gate_access(
    gate: dict, session: Session | None, artist_did: str
) -> None:
    """raise HTTPException if `session` may not stream a track with this gate.

    gate shape: `{"type": "any" | "copyright"}`.
    - "any" (atprotofans supporter-gated): artist or validated supporter
    - "copyright" (indiemusi paradigm): any authenticated listener
    """
    if not session:
        raise HTTPException(
            status_code=401,
            detail="authentication required to stream this track",
        )

    gate_type = gate.get("type")

    if gate_type == "copyright":
        # any authenticated listener is fine
        return

    # default: "any" / supporter-gated semantics
    if session.did == artist_did:
        return

    validation = await validate_supporter(
        supporter_did=session.did, artist_did=artist_did
    )
    if not validation.valid:
        raise HTTPException(
            status_code=402,
            detail="this track requires supporter access",
            headers={"X-Support-Required": "true"},
        )


async def _handle_gated_audio(
    file_id: str,
    file_type: str,
    artist_did: str,
    session: Session | None,
    support_gate: dict,
    is_head_request: bool = False,
    audio_storage: str = "r2",
    pds_blob_cid: str | None = None,
) -> RedirectResponse | Response:
    """handle streaming for access-gated content (supporter or copyright).

    delegates the access check to `_check_gate_access`, then resolves the
    audio URL from private storage (presigned R2 or PDS blob).

    for HEAD requests (used for pre-flight auth checks), returns 200 status
    without redirecting to avoid CORS issues with cross-origin redirects.
    """
    await _check_gate_access(support_gate, session, artist_did)

    if is_head_request:
        return Response(status_code=200)

    # artist always sees their own track; otherwise we already validated above
    if session is not None and session.did != artist_did:
        logfire.info(
            "serving gated content",
            file_id=file_id,
            gate_type=support_gate.get("type"),
            listener_did=session.did,
            artist_did=artist_did,
        )

    # PDS-backed gated tracks: redirect to PDS blob (only applies to supporter
    # gating; copyright tracks never get uploaded to PDS as a blob)
    if audio_storage == "pds" and pds_blob_cid:
        if artist_pds_url := await _resolve_pds_url(artist_did):
            return RedirectResponse(
                url=pds_blob_url(artist_pds_url, artist_did, pds_blob_cid)
            )

    # R2-backed gated tracks: presigned URL for private bucket
    url = await storage.generate_presigned_url(file_id=file_id, extension=file_type)
    return RedirectResponse(url=url)


@router.get("/{file_id}/download")
async def download_audio(file_id: str) -> RedirectResponse:
    """download a track's audio as an attachment named `artist - title.ext`.

    downloads are offered only where the bytes are already publicly
    reachable (the artist's PDS serves them to anyone): public and unlisted
    tracks that are not supporter-gated, not copyright-flagged, and whose
    artist has not switched downloads off. prefers the preserved lossless
    original over the streaming rendition.
    """
    async with db_session() as db:
        result = await db.execute(
            select(
                Track.id,
                Track.title,
                Track.file_id,
                Track.file_type,
                Track.original_file_id,
                Track.original_file_type,
                Track.r2_url,
                Track.support_gate,
                Track.is_private,
                Track.audio_storage,
                Track.self_labels,
                Track.operator_labels,
                Track.moderation_override,
                Artist.display_name,
                UserPreferences.allow_downloads,
            )
            .join(Artist, Artist.did == Track.artist_did)
            .outerjoin(UserPreferences, UserPreferences.did == Track.artist_did)
            .where(or_(Track.file_id == file_id, Track.original_file_id == file_id))
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        row = result.first()

        if not row:
            raise HTTPException(status_code=404, detail="audio file not found")

    refusal = download_refusal(
        is_private=row.is_private,
        support_gate=row.support_gate,
        labels=set(row.self_labels or []) | set(row.operator_labels or []),
        moderation_override=row.moderation_override,
        allow_downloads=row.allow_downloads,
    )
    match refusal:
        case "private":
            # same shape as a missing file, so private tracks don't leak
            raise HTTPException(status_code=404, detail="audio file not found")
        case "gated":
            raise HTTPException(
                status_code=403, detail="gated tracks cannot be downloaded"
            )
        case "copyright":
            raise HTTPException(
                status_code=403, detail="this track is not available for download"
            )
        case "artist_opt_out":
            raise HTTPException(
                status_code=403, detail="the artist has disabled downloads"
            )

    key = download_key(
        file_id=row.file_id,
        file_type=row.file_type,
        original_file_id=row.original_file_id,
        original_file_type=row.original_file_type,
        r2_url=row.r2_url,
        audio_storage=row.audio_storage,
    )
    if key is None:
        # we hold no object to serve as a file (PDS-only or unmirrored ingest)
        raise HTTPException(status_code=404, detail="no downloadable file")

    filename = download_filename(row.display_name, row.title, key.extension)
    url = await storage.generate_download_url(key=key.key, filename=filename)
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
                Track.audio_storage,
                Track.pds_blob_cid,
                Track.is_private,
                Track.space_uri,
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
            audio_storage,
            pds_blob_cid,
            is_private,
            _space_uri,
        ) = track_data

    # private media is proxied through the permissioned-space credential path,
    # so the cacheable "url" is this backend's own stream endpoint (which holds
    # the credential), not a presigned/CDN URL the client could fetch directly.
    if is_private:
        if session is None or session.did != artist_did:
            raise HTTPException(status_code=404, detail="audio file not found")
        backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
        return AudioUrlResponse(
            url=f"{backend_url}/audio/{file_id}",
            file_id=file_id,
            file_type=file_type,
        )

    # determine if we're serving the original lossless file
    serving_original = file_id == original_file_id and original_file_type is not None
    serve_file_id = file_id if serving_original else track_file_id
    serve_file_type = original_file_type if serving_original else file_type

    # check if track is gated
    if support_gate is not None:
        await _check_gate_access(support_gate, session, artist_did)

        # PDS-backed gated tracks: return PDS blob URL
        if audio_storage == "pds" and pds_blob_cid:
            if artist_pds_url := await _resolve_pds_url(artist_did):
                return AudioUrlResponse(
                    url=pds_blob_url(artist_pds_url, artist_did, pds_blob_cid),
                    file_id=serve_file_id,
                    file_type=serve_file_type,
                )

        # R2-backed gated tracks: presigned URL for private bucket
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

    # PDS-only tracks: return PDS getBlob URL
    if audio_storage == "pds" and pds_blob_cid and not r2_url:
        if artist_pds_url := await _resolve_pds_url(artist_did):
            return AudioUrlResponse(
                url=pds_blob_url(artist_pds_url, artist_did, pds_blob_cid),
                file_id=serve_file_id,
                file_type=serve_file_type,
            )

    # otherwise, resolve it
    if url := await storage.get_url(
        serve_file_id, file_type="audio", extension=serve_file_type
    ):
        return AudioUrlResponse(
            url=url, file_id=serve_file_id, file_type=serve_file_type
        )

    # R2 has nothing — fall back to the artist's own copy (see `stream_audio`).
    if pds_blob_cid and (artist_pds_url := await _resolve_pds_url(artist_did)):
        return AudioUrlResponse(
            url=pds_blob_url(artist_pds_url, artist_did, pds_blob_cid),
            file_id=serve_file_id,
            file_type=serve_file_type,
        )

    raise HTTPException(status_code=404, detail="audio file not found")


def _relay_headers(resp) -> dict[str, str]:
    return {k: resp.headers[k] for k in _PROXY_HEADERS if k in resp.headers}


async def _handle_private_audio(
    *,
    session: Session | None,
    artist_did: str,
    space_uri: str | None,
    pds_blob_cid: str | None,
    request: Request,
    is_head_request: bool,
) -> Response:
    """proxy a private track's audio through the permissioned-space credential path.

    access is owner-only at two layers: plyr.fm rejects non-owners here, while the
    ``simplespace`` created for this MVP uses its explicit ``member-list`` policy.
    Core permissioned spaces do not enumerate readers, but ``simplespace`` is the
    required PDS management layer above that core protocol and may maintain members.
    A non-owner (or anonymous) request gets a 404 — the same as a missing file — so
    private tracks do not leak their existence. Range is passed through so the
    206/seek semantics survive the proxy.
    """
    if session is None or session.did != artist_did:
        raise HTTPException(status_code=404, detail="audio file not found")
    if not (space_uri and pds_blob_cid):
        raise HTTPException(status_code=404, detail="audio file not found")

    cm = open_space_blob(
        session,
        space=space_uri,
        repo=artist_did,
        cid=pds_blob_cid,
        range_header=request.headers.get("range"),
    )
    try:
        resp = await cm.__aenter__()
    except SpaceAccessError as exc:
        raise HTTPException(
            status_code=403, detail="permissioned access denied"
        ) from exc

    headers = _relay_headers(resp)
    if is_head_request:
        status = resp.status_code
        await cm.__aexit__(None, None, None)
        return Response(status_code=status, headers=headers)

    async def body():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await cm.__aexit__(None, None, None)

    return StreamingResponse(body(), status_code=resp.status_code, headers=headers)
