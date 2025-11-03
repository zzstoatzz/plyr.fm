# streaming uploads design

**status**: proposed
**date**: 2025-11-03
**author**: claude
**issue**: #25

## problem

current upload implementation loads entire audio files into memory, causing OOM risk:

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

## solution: streaming approach

### goals
1. constant memory usage regardless of file size
2. maintain backward compatibility (same file_id generation)
3. support both R2 and filesystem backends
4. no changes to upload endpoint API
5. add proper test coverage

### new flow (constant memory)
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

## detailed design

### 1. chunked hash utility

create reusable utility for streaming hash calculation:

**location**: `src/relay/utils/hashing.py` (new file)

```python
import hashlib
from typing import BinaryIO

CHUNK_SIZE = 8 * 1024 * 1024  # 8MB chunks

def hash_file_chunked(file_obj: BinaryIO, algorithm: str = "sha256") -> str:
    """compute hash by reading file in chunks.

    args:
        file_obj: file-like object to hash
        algorithm: hash algorithm (default: sha256)

    returns:
        hexadecimal digest string

    note:
        file pointer is reset to beginning after hashing
    """
    hasher = hashlib.new(algorithm)
    file_obj.seek(0)

    while chunk := file_obj.read(CHUNK_SIZE):
        hasher.update(chunk)

    file_obj.seek(0)  # reset for subsequent operations
    return hasher.hexdigest()
```

### 2. R2 storage backend

**file**: `src/relay/storage/r2.py`

**changes**:
- replace `file.read()` with `hash_file_chunked()`
- replace `put_object(Body=content)` with `upload_fileobj(Fileobj=file)`
- boto3's `upload_fileobj` automatically handles multipart uploads for files >5MB

```python
def save(self, file: BinaryIO, filename: str) -> str:
    """save audio file to R2 using streaming upload."""
    # compute hash in chunks (constant memory)
    from relay.utils.hashing import hash_file_chunked
    file_id = hash_file_chunked(file)[:16]

    # validate extension
    ext = Path(filename).suffix.lower()
    audio_format = AudioFormat.from_extension(ext)
    if not audio_format:
        raise ValueError(f"unsupported file type: {ext}")

    key = f"audio/{file_id}{ext}"

    # stream upload to R2 (constant memory)
    self.client.upload_fileobj(
        Fileobj=file,
        Bucket=self.bucket_name,
        Key=key,
        ExtraArgs={"ContentType": audio_format.media_type},
    )

    return file_id
```

### 3. filesystem storage backend

**file**: `src/relay/storage/filesystem.py`

**changes**:
- replace `file.read()` with `hash_file_chunked()`
- replace `write_bytes(content)` with `shutil.copyfileobj()`

```python
import shutil
from relay.utils.hashing import hash_file_chunked, CHUNK_SIZE

def save(self, file: BinaryIO, filename: str) -> str:
    """save audio file to filesystem using streaming."""
    # compute hash in chunks
    file_id = hash_file_chunked(file)[:16]

    # validate extension
    ext = Path(filename).suffix.lower()
    audio_format = AudioFormat.from_extension(ext)
    if not audio_format:
        raise ValueError(f"unsupported file type: {ext}")

    file_path = self.base_path / f"{file_id}{ext}"

    # stream copy to disk (constant memory)
    with open(file_path, "wb") as dest:
        shutil.copyfileobj(file, dest, length=CHUNK_SIZE)

    return file_id
```

### 4. upload endpoint

**file**: `src/relay/api/tracks.py`

**changes**: none required!

FastAPI's `UploadFile` already uses `SpooledTemporaryFile`:
- keeps small files (<1MB) in memory
- automatically spools larger files to disk
- provides file-like interface that our streaming functions expect

## testing strategy

### 1. unit tests for hash utility

**file**: `tests/test_hashing.py` (new)

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

**file**: `tests/test_streaming_uploads.py` (new)

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

## rollout plan

### phase 1: implement (this PR)
1. create `relay/utils/hashing.py` with chunked hash utility
2. refactor `R2Storage.save()` to use streaming
3. refactor `FilesystemStorage.save()` to use streaming
4. add unit tests for hash utility
5. add integration tests for large file uploads

### phase 2: validate
1. test locally with 40-50MB files
2. monitor memory usage during tests
3. verify file_id generation stays consistent
4. test concurrent uploads (3-5 simultaneous)

### phase 3: deploy
1. create feature branch
2. open PR with test results
3. merge via GitHub (triggers automated deployment)
4. monitor Logfire for memory metrics
5. test in production with real uploads

## backward compatibility

### file_id generation
- hash algorithm: same (SHA256)
- truncation: same (16 chars)
- **result**: existing file_ids remain valid

### API contract
- endpoint: same (`POST /tracks/`)
- parameters: same (title, file, album, features)
- response: same structure
- **result**: no breaking changes for clients

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

## metrics and observability

track these metrics in Logfire:

1. upload duration (should stay constant regardless of size)
2. memory usage during uploads (should be <50MB)
3. upload success rate (should be >99%)
4. concurrent upload count (track peak concurrency)

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

- boto3 upload_fileobj: https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3/client/upload_fileobj.html
- FastAPI UploadFile: https://fastapi.tiangolo.com/tutorial/request-files/
- Python hashlib: https://docs.python.org/3/library/hashlib.html
- Python shutil: https://docs.python.org/3/library/shutil.html#shutil.copyfileobj
