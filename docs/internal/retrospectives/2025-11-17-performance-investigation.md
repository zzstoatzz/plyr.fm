# Performance Investigation Retrospective - November 17-18, 2025

## Problem Statement

plyr.fm was experiencing severe performance issues:
- Pages showing "no tracks" initially, then loading after several seconds
- Everything felt "laggy" with no clear explanation
- User experience was degrading with no visibility into the root cause

## Investigation Process

### Phase 1: Initial Logfire Analysis

Queried Logfire for slow HTTP requests and found two major issues:

1. **Queue NOTIFY hangs**: `PUT /queue/` requests hanging for **938 seconds** (15.6 minutes)
   - Root cause: Neon PostgreSQL closing connections server-side, but asyncpg thinking connection was still alive
   - Fix: Added 1-second timeout on NOTIFY operations and 5-second heartbeat loop to detect zombie connections
   - Followed Prefect Nebula's proven LISTEN/NOTIFY pattern
   - PR #270 - separate issue from tracks performance

2. **Slow GET /tracks/ requests**: Taking 2-2.5 seconds consistently
   - This became our focus for the rest of the investigation

### Phase 2: Hypothesis - PDS Resolution

**Initial theory**: Resolving ATProto PDS URLs for artists was causing the slowness.

Added debug instrumentation to PDS resolution in `src/backend/api/tracks.py`:
```python
with logfire.span("resolve PDS URLs", artist_count=len(artists_to_resolve)):
    # ... resolution code
```

**Result**: No spans appeared in traces. The code path wasn't even being hit - all artists had cached PDS URLs.

**Lesson**: Instrument before assuming. We wasted time on the wrong hypothesis.

### Phase 3: Hypothesis - R2 get_url Operations

**Theory**: R2 `head_object` calls to check which image format exists were the bottleneck.

Added instrumentation to `src/backend/storage/r2.py`:
```python
async def get_url(self, file_id: str) -> str | None:
    with logfire.span("R2 get_url", file_id=file_id):
        # ... check audio formats, then image formats
```

**Result**: Still no R2 spans showing up in traces.

**Why**: Tracks with missing `image_id` never call `get_url()` at all. The conditional check prevented execution:
```python
if not image_url and track.image_id:  # if image_id is None, never executes
    image_url = await track.get_image_url()
```

### Phase 4: Instrumentation - Track Serialization

Added instrumentation to `src/backend/schemas.py`:
```python
async def from_track(...) -> "TrackResponse":
    with logfire.span("serialize track", track_id=track.id):
        # ...

async def from_album(...) -> "AlbumSummary":
    with logfire.span("serialize album", album_id=album.id):
        # ...
```

**Result**: Serialization was FAST - under 2ms per track, ~0.4ms per album.

This definitively ruled out serialization as the bottleneck.

### Phase 5: The Real Culprit - Database Performance

Looking at complete traces revealed:
- **Database queries**: ~1-1.2 seconds total
- **Serialization**: ~2-3ms total
- **First connection**: 480ms
- **Session query**: 171ms
- **Simple SELECT queries**: 78-157ms each (should be <10ms)

**Root cause**: Neon PostgreSQL connection pooling and serverless scaling issues, not application code.

The ~1 second variance (sometimes 1s, sometimes 2.5s) was due to:
- Neon serverless scaling state (warm vs cold)
- Connection pool state
- Network conditions
- Whether session was already cached

## Critical Discovery: Error Swallowing

While adding instrumentation, we removed broad exception handling:

**Before**:
```python
try:
    await client.head_object(Bucket=bucket, Key=key)
    return url
except client.exceptions.NoSuchKey:
    continue
except Exception:  # ← SWALLOWING ALL ERRORS
    continue
```

**After**:
```python
try:
    await client.head_object(Bucket=bucket, Key=key)
    return url
except client.exceptions.NoSuchKey:
    continue
# removed broad exception handler
```

### The Explosion

After deployment, Logfire immediately showed errors:
```
ClientError: An error occurred (404) when calling the HeadObject operation: Not Found
```

**Tracks failing**: 37, 38, 39, 70, 72
**Time per 404**: 150-600ms
**Impact**: Entire track serialization failing, requests returning errors

### Why This Happened

R2/S3 can raise **two different exceptions** for missing objects:
1. `client.exceptions.NoSuchKey` - S3-specific exception
2. `ClientError` with code `"404"` - generic boto3 error

We only caught the first one. The second was being swallowed by `except Exception: continue`.

### The Fix

Wrote `sandbox/test_r2_404.py` to verify actual R2 behavior:
```python
async def test_r2_404():
    # ... test with real R2 credentials
    try:
        await client.head_object(Bucket=bucket, Key=fake_key)
    except client.exceptions.NoSuchKey as e:
        print("caught NoSuchKey")  # never executed
    except ClientError as e:
        print(f"caught ClientError: {e.response['Error']['Code']}")  # "404"
```

**Confirmed**: R2 raises `ClientError` with code `"404"`, not `NoSuchKey`.

Updated error handling:
```python
try:
    await client.head_object(Bucket=bucket, Key=key)
    return url
except client.exceptions.NoSuchKey:
    continue
except ClientError as e:
    if e.response.get("Error", {}).get("Code") == "404":
        continue
    raise  # re-raise non-404 errors
```

## What We Learned

### Good Decisions

1. **Added comprehensive instrumentation** - Logfire spans gave us visibility into every operation
2. **Removed error swallowing** - Exposed real bugs that were silently degrading performance
3. **Tested assumptions** - Wrote `test_r2_404.py` to verify actual R2 behavior before deploying fix
4. **Followed patterns** - Used Prefect Nebula's proven LISTEN/NOTIFY pattern for queue service

### Bad Decisions

1. **Jumped to conclusions** - Spent time instrumenting PDS resolution without checking if code path was even executing
2. **Didn't read boto3 docs carefully** - Assumed `NoSuchKey` was the only exception for missing objects
3. **Error handling was defensive but wrong** - `except Exception: continue` hid real bugs for months

### Unresolved Issues

1. **Database performance** - Neon connection pooling and query performance still needs investigation
   - SQLAlchemy pool settings (pool_pre_ping, pool_size, max_overflow)
   - Neon serverless scaling configuration
   - Why simple queries take 78-157ms instead of <10ms

2. **R2 image storage inconsistency** - Multiple tracks have `image_id` set but files don't exist in R2
   - Need to audit database vs R2 for orphaned references
   - Consider adding validation/cleanup job

## Call to Action: Technical Debt in tracks.py

This investigation exposed a deeper problem: **`src/backend/api/tracks.py` is a mess**.

### Current Problems

1. **Massive function complexity**: `list_tracks()` is 100+ lines doing:
   - Database queries (multiple SELECT statements)
   - PDS URL caching and resolution
   - Track serialization
   - Like count aggregation
   - Album hydration
   - ATProto URL construction

2. **Poor separation of concerns**: API endpoint directly orchestrates:
   - Data access layer (SQLAlchemy queries)
   - External service calls (R2, PDS resolution)
   - Business logic (caching, deduplication)
   - Response serialization

3. **Hidden dependencies**:
   - `TrackResponse.from_track()` can trigger R2 calls
   - `AlbumSummary.from_album()` can trigger R2 calls
   - No clear contract about what's async and what does I/O

4. **Error handling inconsistency**:
   - Some errors swallowed silently
   - Some errors propagate and fail entire request
   - No clear policy on partial failures

5. **Performance characteristics unclear**:
   - Hard to predict what will be slow
   - Hard to optimize individual pieces
   - Can't easily parallelize independent operations

### What Needs to Happen

We need to **drastically improve the situation in tracks.py** through systematic refactoring:

1. **Extract data access layer**:
   ```python
   class TrackRepository:
       async def get_tracks_with_related(self, filters: TrackFilters) -> list[Track]:
           # all SQLAlchemy queries here
   ```

2. **Separate serialization from I/O**:
   ```python
   # Should never do I/O - all data must be pre-fetched
   def serialize_track(track: Track, image_url: str | None, ...) -> TrackResponse:
       # pure data transformation
   ```

3. **Explicit service layer for external calls**:
   ```python
   class MediaService:
       async def batch_resolve_image_urls(self, file_ids: list[str]) -> dict[str, str]:
           # explicit, batch-able R2 operations
   ```

4. **Clear error handling policy**:
   - Document what errors are expected vs exceptional
   - Decide when to fail fast vs return partial results
   - Add circuit breakers for external service failures

5. **Performance budgets**:
   - Database queries: <50ms total
   - External service calls: <100ms total
   - Serialization: <5ms total
   - **Total request time: <200ms**

### Priority

This is not optional. The current code:
- Makes debugging nearly impossible
- Hides performance problems
- Will continue to cause production issues
- Wastes engineering time on investigations like this one

**We need to allocate time to eliminate this technical debt before it causes more severe problems.**

## Timeline

- **Nov 17, 23:00**: Started investigation, found 938s queue hangs
- **Nov 18, 01:13**: Merged PR #269 (PDS instrumentation - wrong path)
- **Nov 18, 01:36**: Merged PR #270 (queue timeout fix - correct)
- **Nov 18, 01:58**: Merged PR #271 (R2 instrumentation + removed error swallowing)
- **Nov 18, 02:10**: Merged PR #272 (track serialization instrumentation)
- **Nov 18, 02:20**: Discovered ClientError 404s in production
- **Nov 18, 02:37**: Wrote test_r2_404.py, verified actual exception type
- **Nov 18, 02:40**: Created PR #273 (ClientError 404 handling)

## Conclusion

We successfully identified and fixed the queue hang issue. We ruled out several false hypotheses for track loading performance. We exposed real bugs by removing error swallowing, then fixed them properly.

**But the core database performance issue remains unresolved**, and the investigation revealed that `tracks.py` needs serious refactoring before we can make meaningful improvements.

The instrumentation we added will be invaluable for future investigations, but we can't debug our way out of technical debt.
