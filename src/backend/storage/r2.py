"""cloudflare R2 storage for audio files."""

from pathlib import Path
from typing import BinaryIO

import aioboto3
import boto3
import logfire
from botocore.config import Config
from botocore.exceptions import ClientError
from sqlalchemy import func, select

from backend._internal.audio import AudioFormat
from backend.config import settings
from backend.utilities.database import db_session
from backend.utilities.hashing import hash_file_chunked


class R2Storage:
    """store audio files on cloudflare R2."""

    def __init__(self):
        """initialize R2 client."""
        if not all(
            [
                settings.storage.r2_bucket,
                settings.storage.r2_image_bucket,
                settings.storage.r2_endpoint_url,
                settings.storage.aws_access_key_id,
                settings.storage.aws_secret_access_key,
            ]
        ):
            raise ValueError("R2 credentials not configured in environment")

        self.audio_bucket_name = settings.storage.r2_bucket
        self.image_bucket_name = settings.storage.r2_image_bucket
        self.public_audio_bucket_url = settings.storage.r2_public_bucket_url
        self.public_image_bucket_url = settings.storage.r2_public_image_bucket_url

        # sync client for upload (used in background tasks)
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.storage.r2_endpoint_url,
            aws_access_key_id=settings.storage.aws_access_key_id,
            aws_secret_access_key=settings.storage.aws_secret_access_key,
            config=Config(
                request_checksum_calculation="WHEN_REQUIRED",
                response_checksum_validation="WHEN_REQUIRED",
            ),
        )

        # async session for read operations
        self.async_session = aioboto3.Session()
        self.endpoint_url = settings.storage.r2_endpoint_url
        self.aws_access_key_id = settings.storage.aws_access_key_id
        self.aws_secret_access_key = settings.storage.aws_secret_access_key

    async def save(self, file: BinaryIO, filename: str) -> str:
        """save media file to R2 using streaming upload.

        uses chunked hashing and aioboto3's upload_fileobj for constant
        memory usage regardless of file size.

        supports both audio and image files.
        """
        with logfire.span("R2 save", filename=filename):
            # compute hash in chunks (constant memory)
            file_id = hash_file_chunked(file)[:16]
            logfire.info("computed file hash", file_id=file_id)

            # determine file extension and type
            ext = Path(filename).suffix.lower()

            # try audio format first
            audio_format = AudioFormat.from_extension(ext)
            if audio_format:
                key = f"audio/{file_id}{ext}"
                media_type = audio_format.media_type
                image_format = None
            else:
                # try image format
                from backend._internal.image import ImageFormat

                image_format, is_valid = ImageFormat.validate_and_extract(filename)
                if is_valid and image_format:
                    key = f"{file_id}{ext}"
                    media_type = image_format.media_type
                else:
                    raise ValueError(
                        f"unsupported file type: {ext}. "
                        f"supported audio: {AudioFormat.supported_extensions_str()}, "
                        f"supported image: jpg, jpeg, png, webp, gif"
                    )

            # stream upload to R2 (constant memory, non-blocking)
            # file pointer already reset by hash_file_chunked
            bucket = self.image_bucket_name if image_format else self.audio_bucket_name
            logfire.info(
                "uploading to R2", bucket=bucket, key=key, media_type=media_type
            )

            try:
                async with self.async_session.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.aws_access_key_id,
                    aws_secret_access_key=self.aws_secret_access_key,
                ) as client:
                    await client.upload_fileobj(
                        Fileobj=file,
                        Bucket=bucket,
                        Key=key,
                        ExtraArgs={"ContentType": media_type},
                    )
            except Exception as e:
                logfire.error(
                    "R2 upload failed",
                    error=str(e),
                    bucket=bucket,
                    key=key,
                    exc_info=True,
                )
                raise

            logfire.info("R2 upload complete", file_id=file_id, key=key)
            return file_id

    async def get_url(self, file_id: str) -> str | None:
        """get public URL for media file (audio or image)."""
        with logfire.span("R2 get_url", file_id=file_id):
            async with self.async_session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
            ) as client:
                # try audio formats first
                for audio_format in AudioFormat:
                    key = f"audio/{file_id}{audio_format.extension}"

                    try:
                        await client.head_object(Bucket=self.audio_bucket_name, Key=key)
                        return f"{self.public_audio_bucket_url}/{key}"
                    except client.exceptions.NoSuchKey:
                        continue
                    except ClientError as e:
                        if e.response.get("Error", {}).get("Code") == "404":
                            continue
                        raise

                # try image formats
                from backend._internal.image import ImageFormat

                for image_format in ImageFormat:
                    key = f"{file_id}.{image_format.value}"

                    try:
                        await client.head_object(Bucket=self.image_bucket_name, Key=key)
                        return f"{self.public_image_bucket_url}/{key}"
                    except client.exceptions.NoSuchKey:
                        continue
                    except ClientError as e:
                        if e.response.get("Error", {}).get("Code") == "404":
                            continue
                        raise

                return None

    async def delete(self, file_id: str, file_type: str | None = None) -> bool:
        """delete media file from R2.

        only deletes if no other tracks reference this file_id.
        this prevents deleting shared files when duplicates exist.

        args:
            file_id: the file identifier
            file_type: optional file extension (without dot) to delete exact key.
                      if provided, deletes audio/{file_id}.{file_type} directly.
                      if None, falls back to trying all formats (legacy/images).
        """
        # check refcount before deleting
        from backend.models.track import Track

        async with db_session() as db:
            stmt = (
                select(func.count()).select_from(Track).where(Track.file_id == file_id)
            )
            result = await db.execute(stmt)
            refcount = result.scalar_one()

            if refcount > 1:
                logfire.info(
                    "skipping R2 delete, file still referenced",
                    file_id=file_id,
                    refcount=refcount,
                )
                return False

            if refcount == 0:
                logfire.warning(
                    "deleting R2 file with no database references",
                    file_id=file_id,
                )

        # safe to delete - only one or zero references
        logfire.info(
            "attempting R2 delete",
            file_id=file_id,
            refcount=refcount,
            file_type=file_type,
        )

        async with self.async_session.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.aws_access_key_id,
            aws_secret_access_key=self.aws_secret_access_key,
        ) as client:
            # if file_type is provided, delete the exact key
            if file_type:
                audio_format = AudioFormat.from_extension(f".{file_type.lower()}")
                if audio_format:
                    key = f"audio/{file_id}{audio_format.extension}"
                    try:
                        # check if object exists first
                        await client.head_object(Bucket=self.audio_bucket_name, Key=key)
                        # object exists, delete it
                        await client.delete_object(
                            Bucket=self.audio_bucket_name, Key=key
                        )
                        logfire.info(
                            "R2 file deleted",
                            file_id=file_id,
                            key=key,
                            bucket=self.audio_bucket_name,
                        )
                        return True
                    except client.exceptions.ClientError as e:
                        logfire.error(
                            "R2 delete failed for known file_type",
                            file_id=file_id,
                            key=key,
                            file_type=file_type,
                            error=str(e),
                        )
                        return False

            # fallback: try audio formats (for legacy rows or when file_type is None)
            for audio_format in AudioFormat:
                key = f"audio/{file_id}{audio_format.extension}"

                try:
                    # check if object exists first
                    await client.head_object(Bucket=self.audio_bucket_name, Key=key)
                    # object exists, delete it
                    await client.delete_object(Bucket=self.audio_bucket_name, Key=key)
                    logfire.info(
                        "R2 file deleted",
                        file_id=file_id,
                        key=key,
                        bucket=self.audio_bucket_name,
                    )
                    return True
                except client.exceptions.ClientError as e:
                    # object doesn't exist or delete failed, try next format
                    logfire.debug(
                        "R2 delete failed for format",
                        file_id=file_id,
                        key=key,
                        error=str(e),
                    )
                    continue

            # try image formats
            from backend._internal.image import ImageFormat

            for image_format in ImageFormat:
                key = f"{file_id}.{image_format.value}"

                try:
                    # check if object exists first
                    await client.head_object(Bucket=self.image_bucket_name, Key=key)
                    # object exists, delete it
                    await client.delete_object(Bucket=self.image_bucket_name, Key=key)
                    logfire.info(
                        "R2 image deleted",
                        file_id=file_id,
                        key=key,
                        bucket=self.image_bucket_name,
                    )
                    return True
                except client.exceptions.ClientError as e:
                    # object doesn't exist or delete failed, try next format
                    logfire.debug(
                        "R2 delete failed for image format",
                        file_id=file_id,
                        key=key,
                        error=str(e),
                    )
                    continue

            logfire.warning(
                "R2 delete failed - no matching file found",
                file_id=file_id,
                audio_bucket=self.audio_bucket_name,
                image_bucket=self.image_bucket_name,
            )
            return False
