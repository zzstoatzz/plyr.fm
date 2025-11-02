"""cloudflare R2 storage for audio files."""

import hashlib
from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.config import Config

from relay.config import settings
from relay.models import AudioFormat


class R2Storage:
    """store audio files on cloudflare R2."""

    def __init__(self):
        """initialize R2 client."""
        if not all(
            [
                settings.r2_bucket,
                settings.r2_endpoint_url,
                settings.aws_access_key_id,
                settings.aws_secret_access_key,
            ]
        ):
            raise ValueError("R2 credentials not configured in environment")

        self.bucket_name = settings.r2_bucket
        self.public_bucket_url = settings.r2_public_bucket_url
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            config=Config(
                request_checksum_calculation="WHEN_REQUIRED",
                response_checksum_validation="WHEN_REQUIRED",
            ),
        )

    def save(self, file: BinaryIO, filename: str) -> str:
        """save audio file to R2 and return file id."""
        # read file content
        content = file.read()

        # generate file id from content hash
        file_id = hashlib.sha256(content).hexdigest()[:16]

        # determine file extension
        ext = Path(filename).suffix.lower()
        audio_format = AudioFormat.from_extension(ext)
        if not audio_format:
            raise ValueError(
                f"unsupported file type: {ext}. "
                f"supported: {AudioFormat.supported_extensions_str()}"
            )

        # construct s3 key
        key = f"audio/{file_id}{ext}"

        # upload to R2
        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=content,
            ContentType=audio_format.media_type,
        )

        return file_id

    def get_url(self, file_id: str) -> str | None:
        """get public URL for audio file."""
        # try to find file with any supported extension
        for audio_format in AudioFormat:
            key = f"audio/{file_id}{audio_format.extension}"

            # check if object exists
            try:
                self.client.head_object(Bucket=self.bucket_name, Key=key)
                # object exists, return public URL
                return f"{self.public_bucket_url}/{key}"
            except self.client.exceptions.ClientError:
                continue

        return None

    def delete(self, file_id: str) -> bool:
        """delete audio file from R2."""
        for audio_format in AudioFormat:
            key = f"audio/{file_id}{audio_format.extension}"

            try:
                self.client.delete_object(Bucket=self.bucket_name, Key=key)
                return True
            except self.client.exceptions.ClientError:
                continue

        return False
