## problem 1: file upload buffering

**location**: src/relay/storage/r2.py:42-68, src/relay/storage/filesystem.py:18-37

both storage backends load entire audio files into memory (`content = file.read()`), then calculate SHA-256 hash on full content. with 50-200MB WAV files, concurrent uploads will exhaust memory on 1GB Fly.io VMs.

### recommended solution

**streaming hash calculation**:
```python
CHUNK_SIZE = 8 * 1024 * 1024  # 8MB chunks

hasher = hashlib.sha256()
while chunk := file.read(CHUNK_SIZE):
    hasher.update(chunk)
file_id = hasher.hexdigest()[:16]
```

**boto3 multipart uploads**:
```python
from boto3.s3.transfer import TransferConfig

self.client.upload_fileobj(
    file,
    Bucket=self.bucket_name,
    Key=key,
    Config=TransferConfig(
        multipart_threshold=5 * 1024 * 1024,
        multipart_chunksize=CHUNK_SIZE,
        max_concurrency=10
    )
)
```

**benefits**: constant memory usage regardless of file size, proper R2 multipart handling

---

## problem 2: API response caching

**location**: src/relay/api/tracks.py:193-223 (list_tracks PDS resolution)

every GET /tracks call creates fresh `AsyncDidResolver` and hits public DID endpoints for each unique artist. with dozens of tracks, this becomes a waterfall of outbound HTTP causing 200+ms page loads.

### recommended solution

**implement Redis caching with fastapi-cache2** (Redis already configured in settings):

```python
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from fastapi_cache.decorator import cache

# startup
redis = aioredis.from_url(settings.redis_url)
FastAPICache.init(RedisBackend(redis), prefix="relay-cache")

# apply to resolution
@cache(expire=86400)  # 24 hours
async def resolve_handle(handle: str) -> dict | None:
    ...
```

**TTL recommendations** (based on ATProto specifications):
- DID resolution: 24 hours max (per ATProto docs)
- handle → DID mapping: 24 hours
- profile data (display name, avatar): 1-4 hours
- PDS URLs: 24 hours (rarely change)

### alternative: persist PDS URLs

store resolved PDS alongside artist records to eliminate resolution on every list_tracks call.

---

## implementation priority

### high priority (immediate memory concerns)
1. streaming hash calculation - prevents OOM
2. boto3 upload_fileobj - proper multipart handling
3. DID resolution caching - 24h TTL with Redis

### medium priority (performance optimization)
4. profile caching - 1-4h TTL reduces latency
5. PDS URL persistence - eliminates redundant resolutions
6. cache warming - pre-populate featured artists

### low priority (advanced features)
7. resumable uploads - TUS protocol if reliability issues emerge
8. event-based cache invalidation - if firehose integration added
9. stale-while-revalidate - for high-traffic endpoints

## references

- AWS recommends 8MB chunks for multipart uploads
- ATProto docs specify 24h max TTL for identity metadata
- fastapi-cache2: https://github.com/long2ice/fastapi-cache
- boto3 transfer config: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/customizations/s3.html#boto3.s3.transfer.TransferConfig

## priority

**high** - memory exhaustion risk under load, significant latency improvements
