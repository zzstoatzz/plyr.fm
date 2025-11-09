"""cloudflare R2 storage for audio files."""

from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.config import Config

from backend.config import settings
from backend.models import AudioFormat
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

    def save(self, file: BinaryIO, filename: str) -> str:
        """save media file to R2 using streaming upload.

        uses chunked hashing and boto3's upload_fileobj for constant
        memory usage regardless of file size.

        supports both audio and image files.
        """
        # compute hash in chunks (constant memory)
        file_id = hash_file_chunked(file)[:16]

        # determine file extension and type
        ext = Path(filename).suffix.lower()

        # try audio format first
        audio_format = AudioFormat.from_extension(ext)
        if audio_format:
            key = f"audio/{file_id}{ext}"
            media_type = audio_format.media_type
        else:
            # try image format
            from backend.models.image import ImageFormat

            image_format = ImageFormat.from_filename(filename)
            if image_format:
                key = f"{file_id}{ext}"
                media_type = image_format.media_type
            else:
                raise ValueError(
                    f"unsupported file type: {ext}. "
                    f"supported audio: {AudioFormat.supported_extensions_str()}, "
                    f"supported image: jpg, jpeg, png, webp, gif"
                )

        # stream upload to R2 (constant memory)
        # file pointer already reset by hash_file_chunked
        bucket = self.image_bucket_name if image_format else self.audio_bucket_name
        self.client.upload_fileobj(
            Fileobj=file,
            Bucket=bucket,
            Key=key,
            ExtraArgs={"ContentType": media_type},
        )

        return file_id

    def get_url(self, file_id: str) -> str | None:
        """get public URL for media file (audio or image)."""
        # try audio formats first
        for audio_format in AudioFormat:
            key = f"audio/{file_id}{audio_format.extension}"

            try:
                self.client.head_object(Bucket=self.audio_bucket_name, Key=key)
                return f"{self.public_audio_bucket_url}/{key}"
            except self.client.exceptions.ClientError:
                continue

        # try image formats
        from backend.models.image import ImageFormat

        for image_format in ImageFormat:
            key = f"{file_id}.{image_format.value}"

            try:
                self.client.head_object(Bucket=self.image_bucket_name, Key=key)
                return f"{self.public_image_bucket_url}/{key}"
            except self.client.exceptions.ClientError:
                continue

        return None

    def delete(self, file_id: str) -> bool:
        """delete media file from R2."""
        # try audio formats
        for audio_format in AudioFormat:
            key = f"audio/{file_id}{audio_format.extension}"

            try:
                self.client.delete_object(Bucket=self.audio_bucket_name, Key=key)
                return True
            except self.client.exceptions.ClientError:
                continue

        # try image formats
        from backend.models.image import ImageFormat

        for image_format in ImageFormat:
            key = f"{file_id}.{image_format.value}"

            try:
                self.client.delete_object(Bucket=self.image_bucket_name, Key=key)
                return True
            except self.client.exceptions.ClientError:
                continue

        return False
