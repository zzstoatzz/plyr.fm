# phase 2: ATProto record creation

## overview

write track metadata to user's PDS when they upload audio. the record contains R2 URLs and metadata, creating a decentralized, user-owned music catalog.

## prerequisites

- phase 1 complete (R2 storage working)
- OAuth 2.1 authentication working (already done)
- user has valid session with access tokens

## implementation

### 1. update Track model

add ATProto record tracking:

```python
# src/relay/models/track.py
from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from relay.models.database import Base


class Track(Base):
    """track model."""

    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    artist: Mapped[str] = mapped_column(String, nullable=False)
    album: Mapped[str | None] = mapped_column(String, nullable=True)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    file_type: Mapped[str] = mapped_column(String, nullable=False)
    artist_did: Mapped[str] = mapped_column(String, nullable=False, index=True)
    artist_handle: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # ATProto integration fields
    r2_url: Mapped[str | None] = mapped_column(String, nullable=True)
    atproto_record_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    atproto_record_cid: Mapped[str | None] = mapped_column(String, nullable=True)
```

### 2. create ATProto records module

create `src/relay/atproto/records.py`:

```python
"""ATProto record creation for relay tracks."""

from datetime import datetime, timezone

from atproto import Client
from atproto.exceptions import AtProtocolError

from relay.auth import Session as AuthSession
from relay.auth import oauth_client


async def create_track_record(
    auth_session: AuthSession,
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
) -> tuple[str, str]:
    """create app.relay.track record on user's PDS.

    args:
        auth_session: authenticated user session
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds

    returns:
        tuple of (record_uri, record_cid)

    raises:
        AtProtocolError: if record creation fails
        ValueError: if session is invalid
    """
    # get OAuth session with tokens
    oauth_session = oauth_client.get_session(auth_session.session_id)
    if not oauth_session:
        raise ValueError("OAuth session not found")

    # create authenticated client
    # note: your atproto fork's Client needs PDS URL and access token
    client = Client(base_url=oauth_session.pds_url)

    # set access token from OAuth session
    # this varies based on your fork's implementation
    # check sandbox/atproto-fork for exact API
    client.login(
        access_jwt=oauth_session.access_token,
        refresh_jwt=oauth_session.refresh_token if hasattr(oauth_session, 'refresh_token') else None,
    )

    # construct record
    record = {
        "$type": "app.relay.track",
        "title": title,
        "artist": artist,
        "audioUrl": audio_url,
        "fileType": file_type,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    # add optional fields
    if album:
        record["album"] = album
    if duration:
        record["duration"] = duration

    # write to PDS
    response = await client.com.atproto.repo.create_record(
        repo=auth_session.did,
        collection="app.relay.track",
        record=record,
    )

    return response.uri, response.cid
```

### 3. update upload endpoint

modify `src/relay/api/tracks.py` to create ATProto records:

```python
"""tracks api endpoints."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from relay.atproto.records import create_track_record
from relay.auth import Session as AuthSession
from relay.auth import require_auth
from relay.config import settings
from relay.models import AudioFormat, Track, get_db
from relay.storage import storage

router = APIRouter(prefix="/tracks", tags=["tracks"])


@router.post("/")
async def upload_track(
    title: Annotated[str, Form()],
    artist: Annotated[str, Form()],
    album: Annotated[str | None, Form()] = None,
    file: UploadFile = File(...),
    auth_session: AuthSession = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict:
    """upload a new track (requires authentication)."""
    # validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    ext = Path(file.filename).suffix.lower()
    audio_format = AudioFormat.from_extension(ext)
    if not audio_format:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported file type: {ext}. "
            f"supported: {AudioFormat.supported_extensions_str()}",
        )

    # save audio file to R2
    try:
        file_id = storage.save(file.file, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # get R2 URL
    if settings.storage_backend == "r2":
        from relay.storage.r2 import R2Storage
        if isinstance(storage, R2Storage):
            r2_url = storage.get_url(file_id)
        else:
            r2_url = None
    else:
        # filesystem: construct relay backend URL
        r2_url = f"http://localhost:8001/audio/{file_id}"

    # create ATProto record (if R2 URL available)
    atproto_uri = None
    atproto_cid = None
    if r2_url and settings.storage_backend == "r2":
        try:
            atproto_uri, atproto_cid = await create_track_record(
                auth_session=auth_session,
                title=title,
                artist=artist,
                audio_url=r2_url,
                file_type=ext[1:],  # remove dot
                album=album,
                duration=None,  # TODO: extract from audio file
            )
        except Exception as e:
            # log but don't fail upload if record creation fails
            print(f"warning: failed to create ATProto record: {e}")

    # create track record in local database
    track = Track(
        title=title,
        artist=artist,
        album=album,
        file_id=file_id,
        file_type=ext[1:],
        artist_did=auth_session.did,
        artist_handle=auth_session.handle,
        r2_url=r2_url,
        atproto_record_uri=atproto_uri,
        atproto_record_cid=atproto_cid,
    )

    db.add(track)
    db.commit()
    db.refresh(track)

    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist,
        "album": track.album,
        "file_id": track.file_id,
        "file_type": track.file_type,
        "artist_did": track.artist_did,
        "artist_handle": track.artist_handle,
        "r2_url": track.r2_url,
        "atproto_record_uri": track.atproto_record_uri,
        "created_at": track.created_at.isoformat(),
    }
```

## checking your atproto fork API

since you're using a custom fork, check the actual client API:

```bash
# look at client implementation
cat sandbox/atproto-fork/packages/atproto_client/atproto_client/client.py | grep -A 20 "class Client"

# or check examples
cat sandbox/atproto-fork/examples/*/main.py
```

key questions to answer:
1. how to initialize authenticated client with OAuth tokens?
2. does it use `client.login()` or set tokens directly?
3. what's the method signature for `create_record()`?

## database migration

create migration for new columns:

```bash
# if using alembic
alembic revision -m "add atproto fields to tracks"
```

or manual SQL:
```sql
ALTER TABLE tracks ADD COLUMN r2_url VARCHAR;
ALTER TABLE tracks ADD COLUMN atproto_record_uri VARCHAR;
ALTER TABLE tracks ADD COLUMN atproto_record_cid VARCHAR;
```

for MVP, just delete the database:
```bash
rm data/relay.db
# restart backend (will recreate tables)
```

## testing

### 1. upload with record creation

```bash
# upload via authenticated session
curl -X POST http://localhost:8001/tracks/ \
  -H "Cookie: session_id=your-session" \
  -F "file=@test.mp3" \
  -F "title=test track" \
  -F "artist=test artist"

# response should include:
{
  "atproto_record_uri": "at://did:plc:abc123/app.relay.track/3k2j4h5g6h",
  "r2_url": "https://relay-audio.r2.cloudflarestorage.com/audio/abc123.mp3",
  ...
}
```

### 2. verify record on PDS

use ATProto tools to check record exists:

```python
from atproto import Client

client = Client()
client.login("your-handle", "your-app-password")

# get record
record = client.com.atproto.repo.get_record(
    repo="your-did",
    collection="app.relay.track",
    rkey="3k2j4h5g6h",
)

print(record)
# should show: title, artist, audioUrl, etc.
```

### 3. check via at-me or similar tool

visit your at-me visualization:
- should see `app.relay.track` collection
- records should list all uploaded tracks
- each record should have R2 URL in `audioUrl` field

## error handling

### OAuth token expired

```python
try:
    atproto_uri, atproto_cid = await create_track_record(...)
except AtProtocolError as e:
    if "token" in str(e).lower():
        # token expired, refresh and retry
        await oauth_client.refresh_session(auth_session.session_id)
        atproto_uri, atproto_cid = await create_track_record(...)
    else:
        raise
```

### network failure

```python
import asyncio

try:
    atproto_uri, atproto_cid = await asyncio.wait_for(
        create_track_record(...),
        timeout=10.0,  # 10 second timeout
    )
except asyncio.TimeoutError:
    print("atproto record creation timed out")
    atproto_uri = None
    atproto_cid = None
```

### PDS unavailable

gracefully degrade:
- save track locally without record
- add background job to retry record creation later
- show user "publishing to atproto..." status

## frontend updates

update portal page to show ATProto status:

```svelte
<!-- frontend/src/routes/portal/+page.svelte -->

{#each tracks as track}
  <div class="track-item">
    <div class="track-info">
      <div class="track-title">{track.title}</div>
      <div class="track-meta">
        {track.artist}
        {#if track.atproto_record_uri}
          <span class="atproto-badge" title={track.atproto_record_uri}>
            ✓ published to atproto
          </span>
        {/if}
      </div>
    </div>
  </div>
{/each}

<style>
  .atproto-badge {
    color: #5ce87b;
    font-size: 0.85rem;
    margin-left: 0.5rem;
  }
</style>
```

## next steps

### track discovery (phase 3)

once records are being created:

1. set up jetstream consumer (like status project)
2. listen for `app.relay.track` commits
3. index tracks from other users
4. add discovery feed to frontend

### metadata extraction

add duration extraction:

```bash
uv add mutagen
```

```python
from mutagen import File as MutagenFile

def extract_audio_metadata(file_path: Path) -> dict:
    """extract metadata from audio file."""
    audio = MutagenFile(file_path)
    return {
        "duration": int(audio.info.length) if audio.info else None,
        # add more metadata as needed
    }
```

### record updates

allow users to update track metadata:

```python
async def update_track_record(
    auth_session: AuthSession,
    record_uri: str,
    **updates,
) -> str:
    """update existing record."""
    # parse record URI to get rkey
    rkey = record_uri.split("/")[-1]

    # get current record
    record = await client.com.atproto.repo.get_record(
        repo=auth_session.did,
        collection="app.relay.track",
        rkey=rkey,
    )

    # update fields
    record.update(updates)

    # write back
    response = await client.com.atproto.repo.put_record(
        repo=auth_session.did,
        collection="app.relay.track",
        rkey=rkey,
        record=record,
    )

    return response.cid
```

## security considerations

### validate R2 URLs

ensure URLs only point to your R2 bucket:

```python
def validate_r2_url(url: str) -> bool:
    """ensure URL is from our R2 bucket."""
    from urllib.parse import urlparse

    parsed = urlparse(url)
    allowed_domains = [
        settings.r2_public_domain,
        f"{settings.r2_account_id}.r2.cloudflarestorage.com",
    ]
    return parsed.hostname in allowed_domains
```

### rate limiting

prevent spam record creation:

```python
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter

@router.post("/", dependencies=[Depends(RateLimiter(times=10, seconds=3600))])
async def upload_track(...):
    """upload track (max 10/hour)."""
    ...
```

## monitoring

### track record creation success rate

```python
import logging

logger = logging.getLogger(__name__)

try:
    atproto_uri, atproto_cid = await create_track_record(...)
    logger.info(f"created atproto record: {atproto_uri}")
except Exception as e:
    logger.error(f"failed to create atproto record: {e}", exc_info=True)
```

### dashboard metrics

add to admin panel:
- total tracks uploaded
- tracks with ATProto records
- record creation success rate
- average record creation latency

## references

- atproto repo spec: https://atproto.com/specs/repository
- atproto lexicon spec: https://atproto.com/specs/lexicon
- your atproto fork: `sandbox/atproto-fork/`
- example record creation: `sandbox/at-me/` and `sandbox/status/`
