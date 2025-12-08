# liked tracks

## overview

plyr.fm's liked tracks feature allows users to like tracks, with likes stored as ATProto records on the user's PDS and indexed locally for fast queries. the implementation includes comprehensive error handling to ensure consistency between ATProto and the local database.

## ATProto integration

### fm.plyr.like namespace

individual likes are stored as ATProto records using the `fm.plyr.like` collection:

```json
{
  "$type": "fm.plyr.like",
  "subject": {
    "uri": "at://did:plc:artist123/fm.plyr.track/abc123",
    "cid": "bafytrack123"
  },
  "createdAt": "2025-11-11T00:00:00.000Z"
}
```

**fields**:
- `subject.uri` - AT-URI of the liked track
- `subject.cid` - CID of the track record at time of like
- `createdAt` - ISO 8601 timestamp

### fm.plyr.list namespace (liked list)

in addition to individual like records, users have a single aggregated "liked tracks" list record:

```json
{
  "$type": "fm.plyr.list",
  "name": "Liked Tracks",
  "listType": "liked",
  "items": [
    { "subject": { "uri": "at://did:plc:.../fm.plyr.track/abc", "cid": "bafy..." } },
    { "subject": { "uri": "at://did:plc:.../fm.plyr.track/def", "cid": "bafy..." } }
  ],
  "createdAt": "2025-12-07T00:00:00.000Z",
  "updatedAt": "2025-12-07T12:00:00.000Z"
}
```

**fields**:
- `name` - always "Liked Tracks"
- `listType` - always "liked"
- `items` - ordered array of strongRefs (uri + cid) to liked tracks
- `createdAt` - when the list was first created
- `updatedAt` - when the list was last modified

**sync behavior**:
- the liked list record is synced automatically on login (via `GET /artists/me`)
- sync happens as a fire-and-forget background task, doesn't block the response
- the list URI/CID are stored in `user_preferences.liked_list_uri` and `liked_list_cid`
- liking/unliking a track also triggers a list update via the backend

**reordering**:
- users can reorder their liked tracks via `PUT /lists/liked/reorder`
- the reordered list is written to the PDS via `putRecord`

### record lifecycle

**creating a like**:
1. user clicks like button
2. backend creates ATProto record on user's PDS
3. backend commits like to local database
4. if database commit fails, ATProto record is deleted (cleanup)

**removing a like**:
1. user clicks unlike button
2. backend deletes ATProto record from user's PDS
3. backend removes like from local database
4. if database commit fails, ATProto record is recreated (rollback)

## database schema

### TrackLike model

```python
class TrackLike(Base):
    __tablename__ = "track_likes"

    id: Mapped[int] = mapped_column(primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey("tracks.id"))
    user_did: Mapped[str] = mapped_column(String(255))
    atproto_like_uri: Mapped[str] = mapped_column(String(512), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    # relationships
    track: Mapped["Track"] = relationship(back_populates="likes")
```

**indexes**:
- `(track_id, user_did)` - unique constraint to prevent duplicate likes
- `user_did` - fast lookups for user's liked tracks
- `atproto_like_uri` - unique constraint for ATProto record references

## API endpoints

### POST /tracks/{track_id}/like

like a track.

**authentication**: required (OAuth session)

**response**:
```json
{
  "liked": true
}
```

**status codes**:
- 200: like created or already exists (idempotent)
- 401: not authenticated
- 404: track not found
- 500: operation failed (with cleanup)

**idempotency**: calling this endpoint multiple times for the same track has no effect after the first successful call.

### DELETE /tracks/{track_id}/like

unlike a track.

**authentication**: required (OAuth session)

**response**:
```json
{
  "liked": false
}
```

**status codes**:
- 200: like removed or didn't exist (idempotent)
- 401: not authenticated
- 404: track not found
- 500: operation failed (with rollback)

**idempotency**: calling this endpoint multiple times for the same track has no effect after the first successful call.

### POST /tracks/likes/batch

get like status for multiple tracks at once.

**authentication**: required (OAuth session)

**request body**:
```json
{
  "track_ids": [1, 2, 3, 4, 5]
}
```

**response**:
```json
{
  "1": true,
  "2": false,
  "3": true,
  "4": false,
  "5": true
}
```

**status codes**:
- 200: success (returns empty object if no tracks provided)
- 401: not authenticated

**use case**: efficiently load like status for a list of tracks (e.g., all tracks on current page) without N+1 queries.

## error handling

### consistency guarantees

the implementation ensures that ATProto records and local database remain consistent even when operations fail.

### like operation error handling

```python
# 1. create ATProto record
like_uri = await create_like_record(
    auth_session=auth_session,
    subject_uri=track.atproto_record_uri,
    subject_cid=track.atproto_record_cid,
)

# 2. create database entry
like = TrackLike(
    track_id=track_id,
    user_did=auth_session.did,
    atproto_like_uri=like_uri,
)
db.add(like)

# 3. commit with error handling
try:
    await db.commit()
except Exception as e:
    # cleanup: delete orphaned ATProto record
    try:
        await delete_record_by_uri(
            auth_session=auth_session,
            record_uri=like_uri,
        )
        logger.info(f"cleaned up orphaned ATProto like record: {like_uri}")
    except Exception as cleanup_exc:
        logger.error(f"failed to clean up: {cleanup_exc}")

    raise HTTPException(
        status_code=500,
        detail="failed to like track - please try again"
    ) from e
```

**why cleanup is needed**:
- ATProto record was created successfully
- database commit failed (network issue, constraint violation, etc.)
- without cleanup, ATProto and database would be inconsistent
- cleanup deletes the ATProto record so user can retry

### unlike operation error handling

```python
# 1. delete ATProto record
await delete_record_by_uri(
    auth_session=auth_session,
    record_uri=like.atproto_like_uri,
)

# 2. remove from database
await db.delete(like)

# 3. commit with error handling
try:
    await db.commit()
except Exception as e:
    # rollback: recreate ATProto record
    try:
        recreated_uri = await create_like_record(
            auth_session=auth_session,
            subject_uri=track.atproto_record_uri,
            subject_cid=track.atproto_record_cid,
        )
        logger.info(f"rolled back: recreated like at {recreated_uri}")
    except Exception as rollback_exc:
        logger.critical(
            f"failed to rollback deletion - systems inconsistent: {rollback_exc}"
        )

    raise HTTPException(
        status_code=500,
        detail="failed to unlike track - please try again"
    ) from e
```

**why rollback is needed**:
- ATProto record was deleted successfully
- database commit failed
- without rollback, user's PDS would not have the like but database would
- rollback recreates the ATProto record to restore consistency

## frontend implementation

### LikeButton component

located at: `frontend/src/lib/components/LikeButton.svelte`

**features**:
- heart icon that fills when track is liked
- optimistic updates (UI updates immediately)
- graceful error handling (reverts on failure)
- accessible (keyboard support, ARIA labels)
- animated transitions

**usage**:
```svelte
<script>
  import LikeButton from '$lib/components/LikeButton.svelte';
</script>

<LikeButton
  trackId={track.id}
  trackTitle={track.title}
  initialLiked={track.liked}
/>
```

**behavior**:
1. user clicks heart icon
2. UI updates immediately (optimistic)
3. API request sent in background
4. if request fails, UI reverts to previous state
5. error toast shown if operation fails

### tracks cache integration

the tracks cache automatically includes like status:

```typescript
// frontend/src/lib/tracks.svelte.ts
class TracksCache {
  async loadTracks() {
    const response = await fetch('/tracks/', {
      credentials: 'include'
    });
    const data = await response.json();

    // each track includes 'liked' field
    this.tracks = data.tracks;
  }
}
```

**like status is included in**:
- GET /tracks/ (latest tracks)
- GET /tracks/{track_id} (single track)
- GET /artists/{artist_did}/tracks (artist's tracks)
- GET /search (search results)

## testing

comprehensive test coverage in `tests/api/test_track_likes.py`:

### test cases

1. **test_like_track_success**
   - verifies normal like operation
   - checks ATProto record creation
   - verifies database entry

2. **test_like_track_cleanup_on_db_failure**
   - simulates database commit failure
   - verifies ATProto record is cleaned up
   - ensures user can retry

3. **test_unlike_track_success**
   - verifies normal unlike operation
   - checks ATProto record deletion
   - verifies database entry removal

4. **test_unlike_track_rollback_on_db_failure**
   - simulates database commit failure
   - verifies ATProto record is recreated
   - ensures consistency is maintained

5. **test_like_already_liked_track_idempotent**
   - verifies liking an already-liked track has no effect
   - ensures no duplicate records created

6. **test_unlike_not_liked_track_idempotent**
   - verifies unliking a not-liked track has no effect
   - ensures no errors thrown

### running tests

```bash
# run all like tests
just test tests/api/test_track_likes.py

# run specific test
just test tests/api/test_track_likes.py::test_like_track_cleanup_on_db_failure

# run with verbose output
just test tests/api/test_track_likes.py -v
```

## performance considerations

### batch like status queries

instead of checking like status for each track individually (N+1 queries), use the batch endpoint:

```typescript
// bad: N+1 queries
for (const track of tracks) {
  const response = await fetch(`/tracks/${track.id}/like`);
  track.liked = (await response.json()).liked;
}

// good: single batch query
const trackIds = tracks.map(t => t.id);
const response = await fetch('/tracks/likes/batch', {
  method: 'POST',
  body: JSON.stringify({ track_ids: trackIds }),
  headers: { 'Content-Type': 'application/json' }
});
const likeStatuses = await response.json();

for (const track of tracks) {
  track.liked = likeStatuses[track.id] || false;
}
```

**performance impact**:
- single batch query: 1 database query (WHERE user_did = ? AND track_id IN (...))
- N individual queries: N database queries
- for 20 tracks on a page: 20x fewer queries

### database indexes

the `(track_id, user_did)` index enables fast lookups:

```sql
-- fast lookup (uses index)
SELECT * FROM track_likes
WHERE track_id = 123 AND user_did = 'did:plc:user456';

-- fast batch lookup (uses index)
SELECT track_id FROM track_likes
WHERE user_did = 'did:plc:user456'
AND track_id IN (1, 2, 3, 4, 5);
```

## monitoring

### metrics to track

1. **like success rate**
   - total likes attempted
   - successful likes
   - failed likes (with cleanup)

2. **unlike success rate**
   - total unlikes attempted
   - successful unlikes
   - failed unlikes (with rollback)

3. **cleanup failures**
   - ATProto records that couldn't be deleted during cleanup
   - requires manual intervention

4. **rollback failures** (critical)
   - ATProto records that couldn't be recreated during rollback
   - indicates data inconsistency
   - requires immediate attention

### logfire queries

```sql
-- find like/unlike operations
SELECT
  span_name,
  message,
  start_timestamp,
  otel_status_code
FROM records
WHERE span_name LIKE '%like%'
ORDER BY start_timestamp DESC;

-- find cleanup failures
SELECT
  message,
  start_timestamp,
  attributes->>'error' as error
FROM records
WHERE message LIKE '%failed to clean up%'
ORDER BY start_timestamp DESC;

-- find rollback failures (critical)
SELECT
  message,
  start_timestamp,
  attributes->>'error' as error
FROM records
WHERE message LIKE '%failed to rollback%'
ORDER BY start_timestamp DESC;
```

## future enhancements

### potential improvements

1. **retry logic**
   - automatic retries for transient failures
   - exponential backoff
   - circuit breaker pattern

2. **background reconciliation**
   - periodic job to check ATProto/database consistency
   - automatically fix inconsistencies
   - alert on persistent issues

3. **like counts**
   - denormalized like counts on Track model
   - updated via database triggers
   - enables sorting by popularity

4. **like notifications**
   - notify artists when their tracks are liked
   - configurable via user preferences
   - delivered via ATProto chat/DMs

## references

- implementation: `src/backend/api/tracks.py:808-933`
- database model: `src/backend/models/track.py`
- ATProto records: `src/backend/atproto/records.py`
- frontend component: `frontend/src/lib/components/LikeButton.svelte`
- tests: `tests/api/test_track_likes.py`
