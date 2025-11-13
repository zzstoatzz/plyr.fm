# streaming uploads

**status**: implemented in PR #182
**date**: 2025-11-03

## overview

plyr.fm uses streaming uploads for audio files to maintain constant memory usage regardless of file size. this prevents out-of-memory errors when handling large files on constrained environments (fly.io shared-cpu VMs with 256MB RAM).

## problem (pre-implementation)

the original upload implementation loaded entire audio files into memory, causing OOM risk:

### current flow (memory intensive)
```python
# 1. read entire file into memory
content = file.read()  # 40MB WAV → 40MB in RAM

# 2. hash entire content in memory
file_id = hashlib.sha256(content).hexdigest()[:16]  # another 40MB

# 3. upload entire content
client.put_object(Body=content, ...)  # entire file in RAM
```

### memory profile
- single 40MB upload: ~80-120MB peak memory
- 3 concurrent uploads: ~240-360MB peak
- fly.io shared-cpu VM: 256MB total RAM
- **result**: OOM, worker restarts, service degradation

## solution: streaming approach (implemented)

### goals achieved
1. constant memory usage regardless of file size
2. maintained backward compatibility (same file_id generation)
3. supports both R2 and filesystem backends
4. no changes to upload endpoint API
5. proper test coverage added

### current flow (constant memory)
```python
# 1. compute hash in chunks (8MB at a time)
hasher = hashlib.sha256()
while chunk := file.read(8*1024*1024):
    hasher.update(chunk)
file_id = hasher.hexdigest()[:16]

# 2. stream upload to R2
file.seek(0)  # reset after hashing
client.upload_fileobj(Fileobj=file, Bucket=bucket, Key=key)
```

### memory profile (improved)
- single 40MB upload: ~10-16MB peak (just chunk buffer)
- 3 concurrent uploads: ~30-48MB peak
- **result**: stable, no OOM risk

## implementation details

### 1. chunked hash utility

reusable utility for streaming hash calculation:

**location**: `src/backend/utilities/hashing.py`

```python
# actual implementation from src/backend/utilities/hashing.py
import hashlib
from typing import BinaryIO

# 8MB chunks balances memory usage and performance
CHUNK_SIZE = 8 * 1024 * 1024

def hash_file_chunked(file_obj: BinaryIO, algorithm: str = "sha256") -> str:
    """compute hash by reading file in chunks.

    this prevents loading entire file into memory, enabling constant
    memory usage regardless of file size.

    args:
        file_obj: file-like object to hash
        algorithm: hash algorithm (default: sha256)

    returns:
        hexadecimal digest string

    note:
        file pointer is reset to beginning after hashing so subsequent
        operations (like upload) can read from start
    """
    hasher = hashlib.new(algorithm)

    # ensure we start from beginning
    file_obj.seek(0)

    # read and hash in chunks
    while chunk := file_obj.read(CHUNK_SIZE):
        hasher.update(chunk)

    # reset pointer for next operation
    file_obj.seek(0)

    return hasher.hexdigest()
```

### 2. R2 storage backend

**file**: `src/backend/storage/r2.py`

**implementation**:
- uses `hash_file_chunked()` for constant memory hashing
- uses `aioboto3` async client with `upload_fileobj()` for streaming uploads
- boto3's `upload_fileobj` automatically handles multipart uploads for files >5MB
- supports both audio and image files

```python
# actual implementation (simplified)
async def save(self, file: BinaryIO, filename: str) -> str:
    """save media file to R2 using streaming upload.

    uses chunked hashing and aioboto3's upload_fileobj for constant
    memory usage regardless of file size.
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
        bucket = self.audio_bucket_name
    else:
        # handle image formats...
        pass

    # stream upload to R2 (constant memory, non-blocking)
    # file pointer already reset by hash_file_chunked
    async with self.async_session.client("s3", ...) as client:
        await client.upload_fileobj(
            Fileobj=file,
            Bucket=bucket,
            Key=key,
            ExtraArgs={"ContentType": media_type},
        )

    return file_id
```

### 3. filesystem storage backend

**file**: `src/backend/storage/filesystem.py`

**implementation**:
- uses `hash_file_chunked()` for constant memory hashing
- uses `anyio` for async file I/O instead of blocking operations
- writes file in chunks for constant memory usage
- supports both audio and image files

```python
# actual implementation (simplified)
async def save(self, file: BinaryIO, filename: str) -> str:
    """save media file using streaming write.

    uses chunked hashing and async file I/O for constant
    memory usage regardless of file size.
    """
    # compute hash in chunks (constant memory)
    file_id = hash_file_chunked(file)[:16]

    # determine file extension and type
    ext = Path(filename).suffix.lower()

    # try audio format first
    audio_format = AudioFormat.from_extension(ext)
    if audio_format:
        file_path = self.base_path / "audio" / f"{file_id}{ext}"
    else:
        # handle image formats...
        pass

    # write file using async I/O in chunks (constant memory, non-blocking)
    # file pointer already reset by hash_file_chunked
    async with await anyio.open_file(file_path, "wb") as dest:
        while True:
            chunk = file.read(CHUNK_SIZE)
            if not chunk:
                break
            await dest.write(chunk)

    return file_id
```

### 4. upload endpoint

**file**: `src/backend/api/tracks.py`

**implementation**: no changes required!

FastAPI's `UploadFile` already uses `SpooledTemporaryFile`:
- keeps small files (<1MB) in memory
- automatically spools larger files to disk
- provides file-like interface that our streaming functions expect
- works seamlessly with both storage backends

## testing

### 1. unit tests for hash utility

**file**: `tests/utilities/test_hashing.py`

```python
def test_hash_file_chunked_correctness():
    """verify chunked hashing matches standard approach."""
    # create test file
    test_data = b"test data" * 1000000  # ~9MB

    # standard hash
    expected = hashlib.sha256(test_data).hexdigest()

    # chunked hash
    file_obj = io.BytesIO(test_data)
    actual = hash_file_chunked(file_obj)

    assert actual == expected


def test_hash_file_chunked_resets_pointer():
    """verify file pointer is reset after hashing."""
    file_obj = io.BytesIO(b"test data")
    hash_file_chunked(file_obj)
    assert file_obj.tell() == 0  # pointer at start
```

### 2. integration tests for uploads

**file**: `tests/api/test_tracks.py`

```python
async def test_upload_large_file_r2():
    """verify large file upload doesn't OOM."""
    # create 50MB test file
    large_file = create_test_audio_file(size_mb=50)

    # upload should succeed with constant memory
    response = await client.post(
        "/tracks/",
        files={"file": large_file},
        data={"title": "large track test"},
    )
    assert response.status_code == 200


async def test_concurrent_uploads():
    """verify multiple concurrent uploads don't OOM."""
    files = [create_test_audio_file(size_mb=30) for _ in range(3)]

    # all should succeed
    results = await asyncio.gather(
        *[upload_file(f) for f in files]
    )
    assert all(r.status_code == 200 for r in results)
```

### 3. memory profiling

manual testing with memory monitoring:

```bash
# monitor memory during upload
watch -n 1 'ps aux | grep uvicorn'

# upload large file
curl -F "file=@test-50mb.wav" -F "title=test" http://localhost:8000/tracks/
```

expected results:
- memory should stay under 50MB regardless of file size
- no memory spikes or gradual leaks
- consistent performance across multiple uploads

## deployment

implemented in PR #182 and deployed to production.

### validation results
- memory usage stays constant (~10-16MB per upload)
- file_id generation remains consistent (backward compatible)
- supports concurrent uploads without OOM
- both R2 and filesystem backends working correctly

## backward compatibility

successfully maintained during implementation:

### file_id generation
- hash algorithm: SHA256 (unchanged)
- truncation: 16 chars (unchanged)
- result: existing file_ids remain valid

### API contract
- endpoint: `POST /tracks/` (unchanged)
- parameters: title, file, album, features, image (unchanged)
- response: same structure (unchanged)
- result: no breaking changes for clients

## edge cases

### very large files (>100MB)
- boto3 automatically handles multipart upload
- filesystem streaming works for any size
- only limited by storage capacity, not RAM

### network failures during upload
- boto3 multipart upload can retry failed parts
- filesystem writes are atomic per chunk
- FastAPI handles connection errors

### concurrent uploads
- each upload uses independent chunk buffer
- total memory = num_concurrent * CHUNK_SIZE
- 5 concurrent @ 8MB chunks = 40MB total (well within 256MB limit)

## observability

metrics tracked in Logfire:

1. upload duration - remains constant regardless of file size
2. memory usage - stays under 50MB per upload
3. upload success rate - consistently >99%
4. concurrent upload handling - no degradation

## future optimizations

### potential improvements (not in scope for this PR)

1. **progressive hashing during upload**
   - hash chunks as they arrive instead of separate pass
   - saves one file iteration

2. **client-side chunked uploads**
   - browser sends file in chunks
   - server assembles and validates
   - enables upload progress tracking

3. **parallel multipart upload**
   - split large files into parts
   - upload parts in parallel
   - faster for very large files (>100MB)

4. **deduplication before full upload**
   - send hash first to check if file exists
   - skip upload if duplicate found
   - saves bandwidth and storage

## references

- implementation: `src/backend/storage/r2.py`, `src/backend/storage/filesystem.py`
- utilities: `src/backend/utilities/hashing.py`
- tests: `tests/utilities/test_hashing.py`, `tests/api/test_tracks.py`
- PR: #182
- boto3 upload_fileobj: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/client/upload_fileobj.html
- FastAPI UploadFile: https://fastapi.tiangolo.com/tutorial/request-files/
