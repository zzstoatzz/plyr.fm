# silent atproto record creation failure

**date**: 2025-11-20
**issue**: track 85 ("me and who") created successfully in database and R2, but ATProto record creation silently failed, leaving track in inconsistent state

## what happened

observed user behavior:
1. uploaded track at 01:53:01 UTC → track 85 created
2. viewed track at 01:57:14 UTC
3. attempted to restore ATProto record at 01:59:36 UTC → 400 error
4. deleted track at 02:03:43 UTC

the user noticed their track wasn't synced to their PDS, tried to fix it with the restore-record endpoint, then gave up and deleted the track entirely.

## trace analysis

### upload trace: `019a9ef70b8fb6e1f00ef1406dbc6505`

the upload followed this sequence:

```
01:53:01.839 - POST /tracks/ received
01:53:02.047 - background processing started
01:53:02.047 - "preparing to save audio file"
01:53:02.048 - R2 save span started
01:53:02.054 - "uploading to R2" (audio/2b582e312c5fe925.m4a to audio-prod)
01:53:02.891 - "R2 upload complete"
01:53:02.893 - "storage.save completed" (file_id: 2b582e312c5fe925)
01:53:02.908 - R2 save span started (image)
01:53:02.909 - "uploading to R2" (8e3bf334910404e1.jpg to images-prod)
01:53:03.142 - "R2 upload complete" (image)
01:53:03.156 - INSERT INTO tracks (database write)
01:53:03.803 - HTTP GET to Bluesky (chat convo lookup)
01:53:04.071 - HTTP POST to Bluesky (send notification)
01:53:04.072 - "sent notification for track 85 to 3m4pexey3kl2j"
01:53:04.073 - UPDATE tracks SET notification_sent=true
```

**what's missing**: no ATProto record creation phase.

expected sequence according to `src/backend/api/tracks/uploads.py:224-251`:

```python
# line 227: we have r2_url, so this condition is true
if r2_url:
    # line 228-232: should see this status update
    upload_tracker.update_status(
        upload_id,
        UploadStatus.PROCESSING,
        "creating atproto record...",
        phase="atproto",
    )
    # line 234-247: should see create_track_record call
    try:
        result = await create_track_record(...)
        if result:
            atproto_uri, atproto_cid = result
    # line 248-251: if fails, just logs warning
    except Exception as e:
        logger.warning(
            f"failed to create ATProto record: {e}", exc_info=True
        )
```

we never saw the "creating atproto record..." log message in the trace. this means either:
1. ATProto record creation threw an exception immediately (caught at line 248)
2. `create_track_record()` returned `None` or falsy value
3. something else prevented this code block from executing

### restore attempt trace: `019a9efd115b0fabccca5d90bd23e3a3`

```
01:59:36.539 - POST /tracks/85/restore-record
01:59:36.797 - HTTP GET to ATProto: list records with collection=app.relay.track
01:59:36.799 - endpoint returned 400
```

the restore-record endpoint queried the user's PDS looking for existing track records but found none matching track 85, confirming the ATProto record was never created.

### deletion trace: `019a9f00d558279bc31e387744ec4f7b`

```
02:03:43.320 - DELETE /tracks/85
02:03:43.367 - "attempting R2 delete" (file_id: 2b582e312c5fe925, refcount: 1)
02:03:43.648 - "R2 file deleted" (audio/2b582e312c5fe925.m4a)
02:03:43.652 - DELETE FROM tracks WHERE tracks.id = 85
```

user cleaned up the orphaned track. proper cleanup happened because refcount was 1.

## code path analysis

### upload background processing

`src/backend/api/tracks/uploads.py:37-339` (`_process_upload_background`)

the function has multiple phases:
1. **validation** (lines 58-68): audio format check
2. **upload** (lines 70-112): save to R2 with progress tracking
3. **duplicate check** (lines 114-136): query for existing track with same file_id
4. **image upload** (lines 145-174): save image to R2 if provided
5. **feature resolution** (lines 191-222): resolve featured artist handles
6. **atproto** (lines 224-251): create ATProto record ← **the problem area**
7. **database** (lines 253-290): create track record
8. **notification** (lines 292-304): send Bluesky DM

**critical behavior at lines 248-251**:

```python
except Exception as e:
    logger.warning(
        f"failed to create ATProto record: {e}", exc_info=True
    )
```

if ATProto record creation fails for any reason:
- exception is caught and logged as warning
- `atproto_uri` and `atproto_cid` remain `None`
- processing continues to database phase
- track is created with `atproto_record_uri=None`
- notification is sent
- upload marked as COMPLETED

### what the user experienced

from the user's perspective:
1. uploaded track "me and who" successfully
2. received notification that upload completed
3. went to their PDS, found no record
4. tried restore-record endpoint, got 400 error
5. decided to delete the track rather than leave it broken

## why this is not ideal

### 1. silent failures create inconsistent state

the system allowed a track to exist in the database without corresponding ATProto record. this violates the implicit assumption that every track should be synced to the user's PDS. from `CLAUDE.md`:

> **ATProto namespaces**: NEVER use Bluesky lexicons (app.bsky.*). ALWAYS use our namespace (fm.plyr.*) for ALL records

if we can't create the ATProto record, we shouldn't create the track at all.

### 2. user received success feedback for partial failure

the upload was marked as COMPLETED and notification was sent, even though a critical step failed. user expected their track to be available on their PDS but it wasn't.

### 3. no mechanism for automatic recovery

once in this state, there's no automatic way to fix it:
- the background task already completed
- restore-record endpoint exists but returned 400 (likely because it couldn't find matching data)
- user's only option was manual deletion

### 4. leaves resources in limbo

R2 files were uploaded successfully and consuming storage, but track wasn't fully functional. if user hadn't manually deleted, these would remain as orphaned resources.

### 5. lack of observability

the failure reason isn't visible in Logfire:
- no error spans captured
- no exception traces
- just missing log messages where ATProto phase should be
- had to infer failure from absence of expected logs

## questions raised

### why did ATProto record creation fail?

we can't determine from the trace because the exception was swallowed. possibilities:
- network timeout to user's PDS
- authentication issue with auth_session
- malformed record data
- rate limiting from PDS
- PDS was temporarily unavailable

### should ATProto record creation block upload success?

current design treats it as optional (catches exception, continues). but the restore-record endpoint and user behavior suggest it's actually required. if track isn't on PDS, user considers it broken.

### what's the right failure mode?

if ATProto record creation fails:
1. should we fail the entire upload?
2. should we retry automatically?
3. should we queue for later retry?
4. should we create track anyway and mark as "needs sync"?

each has tradeoffs around user experience, data consistency, and system complexity.

## related patterns in codebase

### similar optional external operations

`src/backend/api/tracks/uploads.py:292-304` (notification sending):

```python
try:
    await notification_service.send_track_notification(track)
    track.notification_sent = True
    await db.commit()
except Exception as e:
    logger.warning(
        f"failed to send notification for track {track.id}: {e}"
    )
```

notification failures are also caught and logged but don't fail the upload. this makes sense because:
- notification is truly optional
- track is still fully functional without notification
- notification_sent flag tracks the state

but ATProto record creation is different - it's fundamental to the track's existence on the network.

### cleanup on failure

other phases do proper cleanup when they fail. for example, lines 313-322:

```python
except IntegrityError as e:
    await db.rollback()
    error_msg = f"database constraint violation: {e!s}"
    upload_tracker.update_status(
        upload_id, UploadStatus.FAILED, "upload failed", error=error_msg
    )
    # cleanup: delete uploaded file
    with contextlib.suppress(Exception):
        await storage.delete(file_id, audio_format.value)
```

if database write fails, R2 files are cleaned up. but if ATProto fails, nothing is cleaned up.

## related files

- `src/backend/api/tracks/uploads.py:224-251` - ATProto record creation with silent failure
- `src/backend/_internal/atproto/__init__.py` - likely contains `create_track_record()` implementation
- `src/backend/api/tracks/router.py` - probably contains restore-record endpoint
- trace: `019a9ef70b8fb6e1f00ef1406dbc6505` (upload)
- trace: `019a9efd115b0fabccca5d90bd23e3a3` (failed restore)
- trace: `019a9f00d558279bc31e387744ec4f7b` (deletion)

## impact

- **user impact**: user uploaded track, got success message, but track wasn't synced to PDS. had to manually delete.
- **data consistency**: track existed in database and R2 but not on ATProto network
- **observability**: failure reason not visible in logs or traces
- **support burden**: user had to diagnose issue themselves, try restore endpoint, then clean up manually

## lessons learned

- silent failures are worse than loud failures when they create inconsistent state
- external system calls (PDS) should have explicit retry/fallback strategy
- success/failure should be binary at the API boundary, even if internal operations are multi-phase
- warning logs without failure signals hide problems from monitoring
- absence of expected logs in traces is a debugging signal (but easy to miss)

## resolution (2025-11-20)

### root cause identified

the actual failure was **option 3** from our initial analysis: "something else prevented this code block from executing."

when FilesystemStorage was removed in commit `6a14f1b` (2025-11-18), the storage module was refactored to use a `_StorageProxy` wrapper around `R2Storage`:

```python
# src/backend/storage/__init__.py
class _StorageProxy:
    """proxy that lazily initializes storage."""
    def __getattr__(self, name: str):
        return getattr(_get_storage(), name)

storage = _StorageProxy()  # type: ignore[assignment]
```

this broke all `isinstance(storage, R2Storage)` checks throughout the codebase:

```python
# src/backend/api/tracks/uploads.py:138-143 (before fix)
r2_url = None
if isinstance(storage, R2Storage):  # ← always False!
    r2_url = await storage.get_url(
        file_id, file_type="audio", extension=ext[1:]
    )
```

because `storage` is a `_StorageProxy` instance (not `R2Storage`), the isinstance check failed, `get_url()` was never called, and `r2_url` remained `None`.

this caused the upload to skip ATProto record creation entirely (line 227's `if r2_url:` check failed), creating tracks in database/R2 without corresponding PDS records.

### the fix

**PR #299** (2025-11-20): removed all `isinstance(storage, R2Storage)` checks since storage is always R2Storage now that FilesystemStorage is gone.

affected files:
- `src/backend/api/tracks/uploads.py` - audio URL generation
- `src/backend/api/tracks/metadata_service.py` - image URL generation
- `src/backend/api/albums.py` - album image URL
- `src/backend/models/track.py` - track image URL getter
- `src/backend/models/album.py` - album image URL getter

### what we learned

1. **proxy objects break isinstance checks**: when wrapping an object with a proxy, runtime type checks on the proxy fail. the proxy should either inherit from the wrapped type or expose a different interface entirely.

2. **removing backends requires checking all type guards**: when we removed FilesystemStorage, we should have searched for all `isinstance(storage, R2Storage)` checks and evaluated whether they were still necessary.

3. **missing environment variables can be caught early**: production was also missing `R2_PUBLIC_BUCKET_URL` environment variable (never set after R2 migration). this would have caused the same failure even without the isinstance bug. deployment should validate required env vars.

4. **integration tests needed for upload flow**: we had no test that verified the full upload → ATProto sync → notification flow. the bug shipped because our tests mocked storage and never exercised the real isinstance check.

5. **Logfire trace gaps are red flags**: the absence of "R2 get_url" spans in the upload trace was a strong signal something was wrong, but it wasn't caught until user reported the issue.

### user impact

this bug affected all uploads between 2025-11-18 (when #288 merged) and 2025-11-20 (when #299 fixed it). affected users received success notifications but their tracks weren't synced to their PDS, requiring manual cleanup.
