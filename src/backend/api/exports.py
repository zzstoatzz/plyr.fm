"""media export API endpoints."""

import io
import logging
import zipfile
from typing import Annotated

import aioboto3
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.models import Track, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/exports", tags=["exports"])


@router.get("/media")
async def export_media(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """export all tracks for authenticated user as a zip archive.

    returns a zip file containing all audio files for the authenticated user.
    tracks are named with their title and original file extension.
    """
    # query all tracks for the authenticated user
    stmt = (
        select(Track).where(Track.artist_did == session.did).order_by(Track.created_at)
    )
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    if not tracks:
        raise HTTPException(status_code=404, detail="no tracks found to export")

    # create zip archive in memory
    zip_buffer = io.BytesIO()

    async_session = aioboto3.Session()

    async with async_session.client(
        "s3",
        endpoint_url=settings.storage.r2_endpoint_url,
        aws_access_key_id=settings.storage.aws_access_key_id,
        aws_secret_access_key=settings.storage.aws_secret_access_key,
    ) as s3_client:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            # track counter for duplicate titles
            title_counts: dict[str, int] = {}

            for track in tracks:
                if not track.file_id or not track.file_type:
                    logger.warning(
                        "skipping track %s: missing file_id or file_type",
                        track.id,
                    )
                    continue

                # construct R2 key
                key = f"audio/{track.file_id}.{track.file_type}"

                try:
                    # download file from R2
                    response = await s3_client.get_object(
                        Bucket=settings.storage.r2_bucket,
                        Key=key,
                    )

                    # read file content
                    file_content = await response["Body"].read()

                    # create safe filename
                    # handle duplicate titles by appending counter
                    base_filename = f"{track.title}.{track.file_type}"
                    if base_filename in title_counts:
                        title_counts[base_filename] += 1
                        filename = f"{track.title} ({title_counts[base_filename]}).{track.file_type}"
                    else:
                        title_counts[base_filename] = 0
                        filename = base_filename

                    # sanitize filename (remove invalid chars)
                    filename = "".join(
                        c
                        for c in filename
                        if c.isalnum() or c in (" ", ".", "-", "_", "(", ")")
                    )

                    # add to zip
                    zip_file.writestr(filename, file_content)

                    logger.info(
                        "added track to export",
                        track_id=track.id,
                        filename=filename,
                    )

                except Exception as e:
                    logger.error(
                        "failed to add track %s to export: %s",
                        track.id,
                        e,
                        exc_info=True,
                    )
                    # continue with other tracks instead of failing entire export

    # prepare zip for download
    zip_buffer.seek(0)

    return StreamingResponse(
        iter([zip_buffer.getvalue()]),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="plyr-tracks.zip"',
        },
    )
