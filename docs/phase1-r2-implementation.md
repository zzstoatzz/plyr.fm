# phase 1: R2 storage implementation

## overview

migrate audio file storage from local filesystem to cloudflare R2 while maintaining the same interface for the rest of the application.

## setup

### 1. create R2 bucket

```bash
# via cloudflare dashboard or wrangler CLI
wrangler r2 bucket create relay-audio
```

### 2. create API token

in cloudflare dashboard:
1. go to R2 → overview
2. click "manage R2 API tokens"
3. create token with:
   - permissions: read & write
   - bucket: relay-audio

save the credentials:
- access key id
- secret access key
- account id

### 3. configure environment

add to `.env`:
```bash
# cloudflare R2 configuration
R2_ACCOUNT_ID=your-account-id-here
R2_ACCESS_KEY_ID=your-access-key-id-here
R2_SECRET_ACCESS_KEY=your-secret-access-key-here
R2_BUCKET_NAME=relay-audio
R2_PUBLIC_DOMAIN=relay-audio.your-account.r2.cloudflarestorage.com
```

### 4. add dependencies

```bash
uv add boto3 boto3-stubs[s3]
```

## implementation

### config.py updates

add R2 configuration to existing config:

```python
# src/relay/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # ... existing settings ...

    # r2 storage
    r2_account_id: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket_name: str = "relay-audio"
    r2_public_domain: str | None = None

    # storage backend selection
    storage_backend: str = "filesystem"  # or "r2"

settings = Settings()
```

### R2 storage adapter

create `src/relay/storage/r2.py`:

```python
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
        if not all([
            settings.r2_account_id,
            settings.r2_access_key_id,
            settings.r2_secret_access_key,
        ]):
            raise ValueError("R2 credentials not configured in environment")

        # create boto3 s3 client for R2
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
        )
        self.bucket_name = settings.r2_bucket_name
        self.public_domain = settings.r2_public_domain

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
                if self.public_domain:
                    return f"https://{self.public_domain}/{key}"
                return f"https://{settings.r2_account_id}.r2.cloudflarestorage.com/{self.bucket_name}/{key}"
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
```

### update storage __init__.py

modify `src/relay/storage/__init__.py` to support both backends:

```python
"""storage implementations."""

from relay.config import settings

if settings.storage_backend == "r2":
    from relay.storage.r2 import R2Storage
    storage = R2Storage()
else:
    from relay.storage.filesystem import FilesystemStorage
    storage = FilesystemStorage()

__all__ = ["storage"]
```

### update audio endpoint

modify `src/relay/api/audio.py` to handle R2 URLs:

```python
"""audio streaming endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from relay.config import settings
from relay.models import AudioFormat
from relay.storage import storage

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/{file_id}")
async def stream_audio(file_id: str):
    """stream audio file."""

    if settings.storage_backend == "r2":
        # R2: redirect to public URL
        from relay.storage.r2 import R2Storage
        if isinstance(storage, R2Storage):
            url = storage.get_url(file_id)
            if not url:
                raise HTTPException(status_code=404, detail="audio file not found")
            return RedirectResponse(url=url)

    # filesystem: serve file directly
    file_path = storage.get_path(file_id)

    if not file_path:
        raise HTTPException(status_code=404, detail="audio file not found")

    # determine media type based on extension
    audio_format = AudioFormat.from_extension(file_path.suffix)
    media_type = audio_format.media_type if audio_format else "audio/mpeg"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name,
    )
```

## migration strategy

### option A: immediate switch (recommended for MVP)

1. set `STORAGE_BACKEND=r2` in `.env`
2. restart backend
3. all new uploads go to R2
4. old files remain on filesystem (lazy migration)

### option B: migrate existing files

create migration script `scripts/migrate_to_r2.py`:

```python
"""migrate existing audio files from filesystem to R2."""

import sys
from pathlib import Path

from relay.config import settings
from relay.models import Track, get_db
from relay.storage.filesystem import FilesystemStorage
from relay.storage.r2 import R2Storage


def migrate():
    """migrate all audio files from filesystem to R2."""
    fs_storage = FilesystemStorage()
    r2_storage = R2Storage()

    db = next(get_db())
    tracks = db.query(Track).all()

    print(f"migrating {len(tracks)} tracks...")

    for track in tracks:
        file_id = track.file_id
        file_path = fs_storage.get_path(file_id)

        if not file_path:
            print(f"warning: file not found for track {track.id}: {file_id}")
            continue

        # upload to R2
        with open(file_path, "rb") as f:
            try:
                r2_storage.save(f, file_path.name)
                print(f"migrated: {track.title} ({file_id})")
            except Exception as e:
                print(f"error migrating {file_id}: {e}")
                continue

    print("migration complete!")


if __name__ == "__main__":
    migrate()
```

run migration:
```bash
uv run python scripts/migrate_to_r2.py
```

## testing

### 1. upload test

```bash
# upload a track via portal
curl -X POST http://localhost:8001/tracks/ \
  -H "Cookie: session_id=your-session" \
  -F "file=@test.mp3" \
  -F "title=test track" \
  -F "artist=test artist"
```

verify:
- file appears in R2 bucket (via cloudflare dashboard)
- track plays in frontend
- URL in browser network tab points to R2

### 2. streaming test

```bash
# get direct URL
curl -I http://localhost:8001/audio/{file_id}

# should see 307 redirect to R2 URL
# or 200 with file content if using filesystem
```

### 3. deletion test

```bash
# delete via portal or API
curl -X DELETE http://localhost:8001/tracks/{track_id} \
  -H "Cookie: session_id=your-session"
```

verify:
- file removed from R2 bucket
- track removed from database

## rollback plan

if R2 has issues:

1. set `STORAGE_BACKEND=filesystem` in `.env`
2. restart backend
3. files on filesystem still work
4. new uploads go to filesystem

## performance considerations

### latency
- R2 redirect adds ~100ms vs direct file serve
- acceptable for MVP, optimize later if needed

### bandwidth
- R2 egress is free to cloudflare CDN
- direct serve uses backend bandwidth

### caching
- add `Cache-Control` headers for R2 objects:
```python
self.client.put_object(
    # ...
    CacheControl="public, max-age=31536000",  # 1 year
)
```

## security considerations

### public URLs
- R2 bucket needs public read access enabled
- anyone with URL can access file
- acceptable for MVP (music is meant to be shared)

### signed URLs (future enhancement)
if you need temporary access:
```python
def get_signed_url(self, file_id: str, expires_in: int = 3600) -> str:
    """generate signed URL with expiration."""
    key = f"audio/{file_id}.mp3"
    return self.client.generate_presigned_url(
        "get_object",
        Params={"Bucket": self.bucket_name, "Key": key},
        ExpiresIn=expires_in,
    )
```

## cost estimates

cloudflare R2 pricing (as of 2025):
- storage: $0.015/GB/month
- class A operations (writes): $4.50/million
- class B operations (reads): $0.36/million
- egress: free

example costs for 1000 tracks:
- storage: ~10GB = $0.15/month
- uploads: 1000 tracks = $0.005
- streams: 10k plays = $0.004
- **total: ~$0.16/month**

## next steps

after R2 migration is working:

1. add R2 URL to Track model for phase 2:
```python
class Track(Base):
    # ... existing fields ...
    atproto_record_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    r2_url: Mapped[str | None] = mapped_column(String, nullable=True)
```

2. proceed to phase 2: ATProto record creation
