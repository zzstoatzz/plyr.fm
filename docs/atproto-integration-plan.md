# atproto integration plan for relay

## architecture summary

relay uses a **hybrid storage model**:
- **audio files**: stored on cloudflare R2 (not PDS blobs)
- **track metadata**: stored as ATProto records on user's PDS
- **records contain**: R2 URLs pointing to audio files

this approach provides:
- user data sovereignty (metadata lives in user's PDS)
- scalable storage (R2 for large audio files)
- decentralized identity (ATProto DIDs)
- portability (users own their track metadata)

## lexicon design

### `app.relay.track`

**namespace rationale**: using `app.relay.*` because relay is hosted as an application, not under a controlled domain. this is an unofficial, experimental lexicon similar to `app.at-me.visit`.

**record structure**:
```json
{
  "$type": "app.relay.track",
  "title": "song title",
  "artist": "artist name",
  "album": "optional album name",
  "audioUrl": "https://relay-audio.r2.dev/abc123.mp3",
  "fileType": "mp3",
  "duration": 240,
  "createdAt": "2025-10-28T22:30:00Z"
}
```

**field definitions**:
- `$type` (required): `app.relay.track`
- `title` (required): string, max 280 chars
- `artist` (required): string, max 280 chars
- `album` (optional): string, max 280 chars
- `audioUrl` (required): https URL to R2-hosted audio file
- `fileType` (required): string, one of: `mp3`, `wav`, `ogg`, `flac`
- `duration` (optional): integer, seconds
- `createdAt` (required): ISO 8601 timestamp

**record key**: use TID (Timestamp Identifier) for chronological ordering

## implementation phases

### phase 1: R2 storage migration (current priority)

**goal**: migrate from filesystem to cloudflare R2

**tasks**:
1. set up cloudflare R2 bucket and credentials
2. create R2 storage adapter in `src/relay/storage.py`
3. update `upload_track` endpoint to use R2
4. update audio serving endpoint to proxy from R2
5. migrate existing local files to R2

**configuration** (in `.env`):
```bash
# cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=relay-audio
R2_PUBLIC_URL=https://relay-audio.r2.dev
```

### phase 2: ATProto record creation

**goal**: write track metadata to user's PDS when uploading

**tasks**:
1. create `src/relay/atproto/records.py` module
2. implement `create_track_record()` function using existing OAuth client
3. update `upload_track` endpoint to:
   - upload audio to R2 (get URL)
   - create ATProto record with R2 URL
   - store local Track model for fast querying
4. handle record creation errors gracefully

**code structure**:
```python
# src/relay/atproto/records.py
from atproto import Client
from relay.auth import get_oauth_session

async def create_track_record(
    auth_session: Session,
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
) -> str:
    """create app.relay.track record on user's PDS.

    returns: record URI (at://did:plc:.../app.relay.track/tid)
    """
    # get OAuth session with DPoP tokens
    oauth_session = await get_oauth_session(auth_session.session_id)

    # create authenticated client
    client = Client(pds_url=oauth_session.pds_url)
    client.set_access_token(oauth_session.access_token)

    # create record
    record = {
        "$type": "app.relay.track",
        "title": title,
        "artist": artist,
        "audioUrl": audio_url,
        "fileType": file_type,
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }
    if album:
        record["album"] = album
    if duration:
        record["duration"] = duration

    # write to PDS
    response = client.com.atproto.repo.create_record({
        "repo": auth_session.did,
        "collection": "app.relay.track",
        "record": record,
    })

    return response.uri
```

### phase 3: ATProto record indexing

**goal**: discover tracks from other users via firehose or appview

**tasks**:
1. set up jetstream firehose consumer (similar to status project)
2. listen for `app.relay.track` records
3. index discovered tracks in local database
4. add "discover" page showing tracks from network

**deferred**: this is lower priority. focus on upload and playback first.

## data flow diagrams

### upload flow (phase 2)
```
user uploads track
  ↓
relay backend validates file
  ↓
upload audio to R2
  ↓ (returns public URL)
create ATProto record on user's PDS
  ↓ (includes R2 URL)
save Track model locally (with record URI)
  ↓
return success to user
```

### playback flow (existing + phase 1)
```
user clicks track
  ↓
frontend requests /audio/{file_id}
  ↓
backend proxies from R2 (or redirects)
  ↓
audio streams to browser
```

### discovery flow (phase 3, future)
```
relay firehose consumer
  ↓
listens for app.relay.track commits
  ↓
fetches record from PDS
  ↓
verifies R2 URL exists
  ↓
indexes track in local database
  ↓
track appears in discovery feed
```

## OAuth scope considerations

**current scopes**: we only request basic authentication scopes via OAuth 2.1.

**required for record creation**: the OAuth session gives us write access to the user's PDS under their identity. we can create records in their repo without additional scopes.

**NOT using `transition:generic`**: this scope is too broad (gives blanket approval). we're using standard OAuth with appropriate permissions for record creation.

## privacy and user control

### transparency
- users see exactly what record we're creating (show JSON before writing)
- optional: require explicit "publish" confirmation

### data sovereignty
- track metadata lives in user's PDS (they control it)
- users can delete records via their PDS management tools
- relay indexes records but doesn't own them

### opt-in participation
- uploading a track requires authentication
- users explicitly choose to publish

## testing strategy

### phase 1 (R2)
1. upload test file to R2
2. verify public URL works
3. test streaming playback
4. measure latency vs filesystem

### phase 2 (ATProto records)
1. create test record on development PDS
2. verify record appears in repo
3. fetch record via AT URI
4. test error handling (network failures, auth issues)

### phase 3 (indexing)
1. run local jetstream consumer
2. create test record from different account
3. verify relay indexes it
4. test discovery feed

## open questions

1. **R2 authentication**: should audio URLs be signed (temporary) or public?
   - option A: public URLs (simpler, but anyone with URL can access)
   - option B: signed URLs with expiration (more secure, but complex)
   - **recommendation**: start with public, add signing later if needed

2. **record deletion**: when user deletes track, should we:
   - delete R2 file immediately?
   - delete ATProto record?
   - tombstone record but keep R2 file?
   - **recommendation**: delete both R2 file and record

3. **versioning**: if user updates track metadata, should we:
   - update existing record?
   - create new record with new rkey?
   - **recommendation**: update existing record (keep rkey stable)

4. **discovery**: should we:
   - run our own appview/indexer?
   - use bluesky's firehose?
   - start without discovery and add later?
   - **recommendation**: defer discovery to phase 3

## migration checklist

- [ ] set up R2 bucket and credentials
- [ ] implement R2 storage adapter
- [ ] migrate existing files to R2
- [ ] update audio serving to use R2
- [ ] test end-to-end upload and playback
- [ ] implement ATProto record creation
- [ ] add record URI to Track model
- [ ] test record creation on personal PDS
- [ ] update frontend to show "published to ATProto" status
- [ ] document record format for other clients

## references

- atproto repository spec: https://atproto.com/specs/repository
- atproto lexicon spec: https://atproto.com/specs/lexicon
- atproto data model: https://atproto.com/specs/data-model
- cloudflare R2 docs: https://developers.cloudflare.com/r2/
- example unofficial lexicon: `sandbox/at-me/docs/lexicon.md`
