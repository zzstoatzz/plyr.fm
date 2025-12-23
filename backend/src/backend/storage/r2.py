"""cloudflare R2 storage for audio files."""

import time
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

import aioboto3
import boto3
import logfire
from botocore.config import Config
from botocore.exceptions import ClientError
from sqlalchemy import func, select

from backend._internal.audio import AudioFormat
from backend._internal.image import ImageFormat
from backend.config import settings
from backend.utilities.database import db_session
from backend.utilities.hashing import hash_file_chunked


class UploadProgressTracker:
    """tracks upload progress for streaming R2 uploads with throttling.

    boto3's upload_fileobj accepts a Callback parameter that's invoked
    after each chunk. this wrapper throttles those callbacks to avoid
    overwhelming SSE listeners and logfire.
    """

    def __init__(
        self,
        total_size: int,
        callback: Callable[[float], None],
        min_bytes_between_updates: int = 5 * 1024 * 1024,  # 5MB
        min_time_between_updates: float | int = 0.25,  # 250ms
    ):
        """initialize progress tracker.

        args:
            total_size: total file size in bytes
            callback: function to call with progress percentage (0-100)
            min_bytes_between_updates: minimum bytes between progress callbacks
            min_time_between_updates: minimum seconds between progress callbacks
        """
        self.total_size = total_size
        self.callback = callback
        self.min_bytes_between_updates = min_bytes_between_updates
        self.min_time_between_updates = min_time_between_updates

        self.bytes_uploaded = 0
        self.last_update_bytes = 0
        self.last_update_time = time.monotonic()

    def __call__(self, bytes_amount: int) -> None:
        """boto3 callback - invoked after each chunk upload.

        args:
            bytes_amount: number of bytes uploaded in this chunk
        """
        self.bytes_uploaded += bytes_amount

        # calculate progress
        progress_pct = (self.bytes_uploaded / self.total_size) * 100
        bytes_since_update = self.bytes_uploaded - self.last_update_bytes
        time_since_update = time.monotonic() - self.last_update_time

        # throttle: only emit if we've crossed byte or time threshold
        should_update = (
            bytes_since_update >= self.min_bytes_between_updates
            or time_since_update >= self.min_time_between_updates
            or progress_pct >= 99.9  # always emit near completion
        )

        if should_update:
            self.callback(progress_pct)
            self.last_update_bytes = self.bytes_uploaded
            self.last_update_time = time.monotonic()


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
        self.private_audio_bucket_name = settings.storage.r2_private_bucket
        self.public_audio_bucket_url = settings.storage.r2_public_bucket_url
        self.public_image_bucket_url = settings.storage.r2_public_image_bucket_url
        self.presigned_url_expiry = settings.storage.presigned_url_expiry_seconds

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

    async def save(
        self,
        file: BinaryIO,
        filename: str,
        progress_callback: Callable[[float], None] | None = None,
    ) -> str:
        """save media file to R2 using streaming upload.

        uses chunked hashing and aioboto3's upload_fileobj for constant
        memory usage regardless of file size.

        supports both audio and image files.

        args:
            file: file-like object to upload
            filename: original filename (used to determine media type)
            progress_callback: optional callback for upload progress (receives 0-100 percentage)
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
                image_format, is_valid = ImageFormat.validate_and_extract(filename)
                if is_valid and image_format:
                    key = f"images/{file_id}{ext}"
                    media_type = image_format.media_type
                else:
                    raise ValueError(
                        f"unsupported file type: {ext}. "
                        f"supported audio: {AudioFormat.supported_extensions_str()}, "
                        f"supported image: jpg, jpeg, png, webp, gif"
                    )

            # get file size for progress tracking
            # file pointer already reset by hash_file_chunked
            file_size = file.seek(0, 2)  # seek to end
            file.seek(0)  # reset to beginning

            # stream upload to R2 (constant memory, non-blocking)
            bucket = self.image_bucket_name if image_format else self.audio_bucket_name
            logfire.info(
                "uploading to R2",
                bucket=bucket,
                key=key,
                media_type=media_type,
                file_size=file_size,
            )

            try:
                async with self.async_session.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.aws_access_key_id,
                    aws_secret_access_key=self.aws_secret_access_key,
                ) as client:
                    # prepare upload arguments
                    upload_kwargs = {
                        "Fileobj": file,
                        "Bucket": bucket,
                        "Key": key,
                        "ExtraArgs": {"ContentType": media_type},
                    }

                    # add progress callback if provided
                    if progress_callback and file_size > 0:
                        tracker = UploadProgressTracker(file_size, progress_callback)
                        upload_kwargs["Callback"] = tracker

                    await client.upload_fileobj(**upload_kwargs)
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

    async def get_url(
        self,
        file_id: str,
        *,
        file_type: str | None = None,
        extension: str | None = None,
    ) -> str | None:
        """get public URL for media file (audio or image).

        args:
            file_id: the file identifier hash
            file_type: optional file type hint - "audio" or "image"
                      if None, checks both (audio first, then image)
                      if "audio", only checks audio bucket
                      if "image", only checks image bucket
            extension: optional specific extension (e.g., "mp3", "flac")
                      if provided for audio, makes single HEAD request
                      instead of looping through all formats
        """
        with logfire.span(
            "R2 get_url", file_id=file_id, file_type=file_type, extension=extension
        ):
            async with self.async_session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
            ) as client:
                # if file_type is "image", skip audio checks
                if file_type != "image":
                    # if extension is provided, try single format
                    if extension:
                        # normalize extension (remove leading dot if present)
                        ext = extension.lstrip(".")
                        key = f"audio/{file_id}.{ext}"

                        try:
                            await client.head_object(
                                Bucket=self.audio_bucket_name, Key=key
                            )
                            return f"{self.public_audio_bucket_url}/{key}"
                        except client.exceptions.NoSuchKey:
                            # if specific extension not found, fall through to None
                            if file_type == "audio":
                                return None
                        except ClientError as e:
                            if e.response.get("Error", {}).get("Code") == "404":
                                if file_type == "audio":
                                    return None
                            else:
                                raise

                    # fallback: try all audio formats
                    else:
                        for audio_format in AudioFormat:
                            key = f"audio/{file_id}{audio_format.extension}"

                            try:
                                await client.head_object(
                                    Bucket=self.audio_bucket_name, Key=key
                                )
                                return f"{self.public_audio_bucket_url}/{key}"
                            except client.exceptions.NoSuchKey:
                                continue
                            except ClientError as e:
                                if e.response.get("Error", {}).get("Code") == "404":
                                    continue
                                raise

                    # if explicitly looking for audio, stop here
                    if file_type == "audio":
                        return None

                # try image formats
                for image_format in ImageFormat:
                    key = f"images/{file_id}.{image_format.value}"

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

    async def save_gated(
        self,
        file: BinaryIO,
        filename: str,
        progress_callback: Callable[[float], None] | None = None,
    ) -> str:
        """save supporter-gated audio file to private R2 bucket.

        same as save() but uses the private bucket with no public URL.
        files in this bucket are only accessible via presigned URLs.

        args:
            file: file-like object to upload
            filename: original filename (used to determine media type)
            progress_callback: optional callback for upload progress
        """
        if not self.private_audio_bucket_name:
            raise ValueError("R2_PRIVATE_BUCKET not configured")

        with logfire.span("R2 save_gated", filename=filename):
            # compute hash in chunks (constant memory)
            file_id = hash_file_chunked(file)[:16]
            logfire.info("computed file hash for gated content", file_id=file_id)

            # determine file extension - only audio supported for gated content
            ext = Path(filename).suffix.lower()
            audio_format = AudioFormat.from_extension(ext)
            if not audio_format:
                raise ValueError(
                    f"unsupported audio type for gated content: {ext}. "
                    f"supported: {AudioFormat.supported_extensions_str()}"
                )

            key = f"audio/{file_id}{ext}"
            media_type = audio_format.media_type

            # get file size for progress tracking
            file_size = file.seek(0, 2)
            file.seek(0)

            logfire.info(
                "uploading gated content to private R2",
                bucket=self.private_audio_bucket_name,
                key=key,
                media_type=media_type,
                file_size=file_size,
            )

            try:
                async with self.async_session.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.aws_access_key_id,
                    aws_secret_access_key=self.aws_secret_access_key,
                ) as client:
                    upload_kwargs = {
                        "Fileobj": file,
                        "Bucket": self.private_audio_bucket_name,
                        "Key": key,
                        "ExtraArgs": {"ContentType": media_type},
                    }

                    if progress_callback and file_size > 0:
                        tracker = UploadProgressTracker(file_size, progress_callback)
                        upload_kwargs["Callback"] = tracker

                    await client.upload_fileobj(**upload_kwargs)
            except Exception as e:
                logfire.error(
                    "R2 gated upload failed",
                    error=str(e),
                    bucket=self.private_audio_bucket_name,
                    key=key,
                    exc_info=True,
                )
                raise

            logfire.info("R2 gated upload complete", file_id=file_id, key=key)
            return file_id

    async def generate_presigned_url(
        self,
        file_id: str,
        extension: str,
        expires_in: int | None = None,
    ) -> str:
        """generate a presigned URL for accessing gated content.

        presigned URLs allow time-limited access to private bucket objects
        without exposing credentials. the URL includes a signature that
        expires after the specified duration.

        args:
            file_id: the file identifier hash
            extension: file extension (e.g., "mp3", "flac")
            expires_in: optional override for expiry seconds (default from settings)

        returns:
            presigned URL string

        raises:
            ValueError: if private bucket not configured
        """
        if not self.private_audio_bucket_name:
            raise ValueError("R2_PRIVATE_BUCKET not configured")

        ext = extension.lstrip(".")
        key = f"audio/{file_id}.{ext}"
        expiry = expires_in or self.presigned_url_expiry

        with logfire.span(
            "R2 generate_presigned_url",
            file_id=file_id,
            key=key,
            expires_in=expiry,
        ):
            async with self.async_session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                config=Config(signature_version="s3v4"),
            ) as client:
                url = await client.generate_presigned_url(
                    "get_object",
                    Params={
                        "Bucket": self.private_audio_bucket_name,
                        "Key": key,
                    },
                    ExpiresIn=expiry,
                )
                logfire.info(
                    "generated presigned URL",
                    file_id=file_id,
                    expires_in=expiry,
                )
                return url

    async def move_audio(
        self,
        file_id: str,
        extension: str,
        *,
        to_private: bool,
    ) -> str | None:
        """move an audio file between public and private buckets.

        copies the file to the destination bucket, then deletes from source.

        args:
            file_id: the file identifier hash
            extension: file extension (e.g., "mp3", "flac")
            to_private: if True, move public->private; if False, move private->public

        returns:
            new URL if successful (public URL or None for private), None on failure

        raises:
            ValueError: if private bucket not configured
        """
        if not self.private_audio_bucket_name:
            raise ValueError("R2_PRIVATE_BUCKET not configured")

        ext = extension.lstrip(".")
        key = f"audio/{file_id}.{ext}"

        if to_private:
            src_bucket = self.audio_bucket_name
            dst_bucket = self.private_audio_bucket_name
        else:
            src_bucket = self.private_audio_bucket_name
            dst_bucket = self.audio_bucket_name

        with logfire.span(
            "R2 move_audio",
            file_id=file_id,
            key=key,
            to_private=to_private,
        ):
            try:
                async with self.async_session.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.aws_access_key_id,
                    aws_secret_access_key=self.aws_secret_access_key,
                ) as client:
                    # copy to destination
                    await client.copy_object(
                        CopySource={"Bucket": src_bucket, "Key": key},
                        Bucket=dst_bucket,
                        Key=key,
                    )
                    logfire.info(
                        "copied audio file",
                        file_id=file_id,
                        src=src_bucket,
                        dst=dst_bucket,
                    )

                    # delete from source
                    await client.delete_object(Bucket=src_bucket, Key=key)
                    logfire.info("deleted from source bucket", file_id=file_id)

                    # return public URL if moved to public, None if moved to private
                    if to_private:
                        return None
                    return f"{self.public_audio_bucket_url}/{key}"

            except ClientError as e:
                logfire.error(
                    "R2 move_audio failed",
                    file_id=file_id,
                    error=str(e),
                    exc_info=True,
                )
                return None
