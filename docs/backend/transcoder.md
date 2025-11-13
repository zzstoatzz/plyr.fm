# audio transcoder service

## overview

the transcoder is a standalone rust-based HTTP service that handles audio format conversion using ffmpeg. it runs as a separate fly.io app to isolate CPU-intensive transcoding operations from the main backend API.

## architecture

### why separate service?

ffmpeg operations are CPU-intensive and can block the event loop in async python applications. separating the transcoder provides:

- **isolation**: transcoding doesn't affect API latency
- **performance**: rust + tokio provides better concurrency for blocking operations
- **scalability**: can scale transcoder independently from main backend
- **resource allocation**: dedicated CPU/memory for transcoding work

### technology stack

- **rust**: high-performance systems language
- **axum**: async web framework built on tokio
- **ffmpeg**: industry-standard media processing
- **fly.io**: deployment platform with auto-scaling

## API

### POST /transcode

convert audio file to target format.

**authentication**: bearer token via `X-Transcoder-Key` header

**request**: multipart/form-data
- `file`: audio file to transcode
- `target` (optional query param): target format (default: "mp3")

**example**:
```bash
curl -X POST https://plyr-transcoder.fly.dev/transcode?target=mp3 \
  -H "X-Transcoder-Key: $TRANSCODER_AUTH_TOKEN" \
  -F "file=@input.wav" \
  --output output.mp3
```

**response**: transcoded audio file (binary)

**headers**:
- `Content-Type`: appropriate media type for target format
- `Content-Disposition`: attachment with original filename + new extension

**supported formats**:
- mp3 (MPEG Layer 3)
- m4a (AAC in MP4 container)
- wav (PCM audio)
- flac (lossless compression)
- ogg (Vorbis codec)

**status codes**:
- 200: transcoding successful, returns audio file
- 400: invalid input (unsupported format, missing file, etc.)
- 401: missing or invalid authentication token
- 413: file too large (>1GB)
- 500: transcoding failed (ffmpeg error, I/O error, etc.)

### GET /health

health check endpoint (no authentication required).

**response**:
```json
{
  "status": "ok"
}
```

## authentication

### bearer token authentication

the transcoder uses a simple bearer token authentication scheme via the `X-Transcoder-Key` header.

**configuration**:
```bash
# set via fly secrets
fly secrets set TRANSCODER_AUTH_TOKEN="your-secret-token-here" -a plyr-transcoder
```

**local development**:
```bash
# .env file
TRANSCODER_AUTH_TOKEN=dev-token-change-me

# or run without auth (dev mode)
# just run transcoder without setting token
```

**security notes**:
- token should be a random, high-entropy string (use `openssl rand -base64 32`)
- main backend should store token in environment variables
- health endpoint bypasses authentication
- invalid/missing tokens return 401 unauthorized

## transcoding process

### workflow

1. **receive upload**: client sends audio file via multipart form
2. **create temp directory**: isolated workspace for this request
3. **save input file**: write uploaded bytes to temp file
4. **determine format**: sanitize and validate target format
5. **run ffmpeg**: spawn ffmpeg process with appropriate codec settings
6. **stream output**: return transcoded file directly to client
7. **cleanup**: delete temp directory (automatic)

### ffmpeg command

the service constructs ffmpeg commands based on target format:

```bash
# example: convert to MP3
ffmpeg -i input.wav -codec:a libmp3lame -qscale:a 2 -map_metadata 0 output.mp3

# example: convert to M4A (AAC)
ffmpeg -i input.wav -codec:a aac -b:a 192k -map_metadata 0 output.m4a

# example: convert to FLAC (lossless)
ffmpeg -i input.flac -codec:a flac -compression_level 8 -map_metadata 0 output.flac
```

**flags explained**:
- `-i input.wav`: input file
- `-codec:a <codec>`: audio codec to use
- `-qscale:a 2`: variable bitrate quality (0-9, lower = better)
- `-b:a 192k`: constant bitrate (for AAC)
- `-map_metadata 0`: preserve metadata (artist, title, etc.)
- `-compression_level 8`: FLAC compression (0-12, higher = smaller file)

### codec selection

| format | codec | container | typical use case |
|--------|-------|-----------|------------------|
| mp3 | libmp3lame | MPEG | universal compatibility |
| m4a | aac | MP4 | modern devices, good compression |
| wav | pcm_s16le | WAV | lossless, uncompressed |
| flac | flac | FLAC | lossless, compressed |
| ogg | libvorbis | OGG | open format, good compression |

## deployment

### fly.io configuration

**app name**: `plyr-transcoder`
**region**: iad (us-east, washington DC)

**fly.toml**:
```toml
app = "plyr-transcoder"
primary_region = "iad"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory = "1gb"

[env]
  TRANSCODER_HOST = "0.0.0.0"
  TRANSCODER_PORT = "8080"
  TRANSCODER_MAX_UPLOAD_BYTES = "1073741824"  # 1GB
```

**key settings**:
- **auto_stop_machines**: stops VM when idle (cost optimization)
- **auto_start_machines**: starts VM on first request (zero cold-start within seconds)
- **min_machines_running**: 0 (no always-on instances, purely on-demand)
- **memory**: 1GB (sufficient for transcoding typical audio files)

### deployment commands

```bash
# deploy from transcoder directory
cd transcoder && fly deploy

# check status
fly status -a plyr-transcoder

# view logs (blocking - use ctrl+c to exit)
fly logs -a plyr-transcoder

# scale up (for high traffic)
fly scale count 2 -a plyr-transcoder

# scale down (back to auto-scale)
fly scale count 1 -a plyr-transcoder
```

**note**: deployment is done manually from the transcoder directory, not via main backend CI/CD.

### secrets management

```bash
# set authentication token
fly secrets set TRANSCODER_AUTH_TOKEN="$(openssl rand -base64 32)" -a plyr-transcoder

# list secrets (values hidden)
fly secrets list -a plyr-transcoder

# unset secret
fly secrets unset TRANSCODER_AUTH_TOKEN -a plyr-transcoder
```

## integration with main backend

### backend configuration

**note**: the main backend does not currently use the transcoder service. this is available for future use when transcoding features are needed (e.g., format conversion for browser compatibility).

if needed in the future, add to `src/backend/config.py`:

```python
class TranscoderSettings(RelaySettingsSection):
    url: str = Field(
        default="https://plyr-transcoder.fly.dev",
        validation_alias="TRANSCODER_URL"
    )
    auth_token: str = Field(
        default="",
        validation_alias="TRANSCODER_AUTH_TOKEN"
    )
```

### calling from backend

```python
import httpx

async def transcode_audio(
    file: BinaryIO,
    target_format: str = "mp3"
) -> bytes:
    """transcode audio file using transcoder service."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.transcoder.url}/transcode",
            params={"target": target_format},
            files={"file": file},
            headers={"X-Transcoder-Key": settings.transcoder.auth_token},
            timeout=300.0  # 5 minutes for large files
        )
        response.raise_for_status()
        return response.content
```

### error handling

```python
try:
    transcoded = await transcode_audio(file, "mp3")
except httpx.HTTPStatusError as e:
    if e.response.status_code == 401:
        logger.error("transcoder authentication failed")
        raise HTTPException(500, "transcoding service unavailable")
    elif e.response.status_code == 413:
        raise HTTPException(413, "file too large for transcoding")
    else:
        logger.error(f"transcoding failed: {e}")
        raise HTTPException(500, "transcoding failed")
except httpx.TimeoutException:
    logger.error("transcoding timed out")
    raise HTTPException(504, "transcoding took too long")
```

## local development

### prerequisites

- rust toolchain (install via `rustup`)
- ffmpeg (install via `brew install ffmpeg` on macOS)

### running locally

```bash
# from transcoder directory
cd transcoder && cargo run

# with custom port
TRANSCODER_PORT=9000 cargo run

# with debug logging
RUST_LOG=debug cargo run
```

**note**: the transcoder runs on port 8080 by default (configured in fly.toml).

### testing locally

```bash
# start transcoder
just transcoder run

# test health endpoint
curl http://localhost:8082/health

# test transcoding (no auth required in dev mode)
curl -X POST http://localhost:8082/transcode?target=mp3 \
  -F "file=@test.wav" \
  --output transcoded.mp3

# test with authentication
export TRANSCODER_AUTH_TOKEN="dev-token"
cargo run &

curl -X POST http://localhost:8082/transcode?target=mp3 \
  -H "X-Transcoder-Key: dev-token" \
  -F "file=@test.wav" \
  --output transcoded.mp3
```

## performance characteristics

### typical transcoding times

transcoding performance depends on:
- input file size and duration
- source codec complexity
- target codec and quality settings
- available CPU

**benchmarks** (shared-cpu-1x on fly.io):
- 3-minute MP3 (5MB) → MP3: ~2-3 seconds
- 3-minute WAV (30MB) → MP3: ~4-5 seconds
- 10-minute FLAC (50MB) → MP3: ~10-15 seconds

### resource usage

**memory**:
- base process: ~20MB
- active transcoding: +100-200MB per request
- 1GB VM supports 4-5 concurrent transcodes

**CPU**:
- ffmpeg uses 100% of allocated CPU
- single-core sufficient for typical workload
- multi-core would enable parallel processing

### scaling considerations

**when to scale up**:
- average response time >30 seconds
- frequent 503 errors (all VMs busy)
- queue depth increasing

**scaling options**:
1. **horizontal**: increase machine count (`fly scale count 2`)
2. **vertical**: increase memory/CPU (`fly scale vm shared-cpu-2x`)
3. **regional**: deploy to multiple regions for geo-distribution

## monitoring

### metrics to track

1. **transcoding success rate**
   - total requests
   - successful transcodes
   - failed transcodes (by error type)

2. **performance**
   - average transcoding time
   - p50, p95, p99 latency
   - throughput (transcodes/minute)

3. **resource usage**
   - CPU utilization
   - memory usage
   - disk I/O (temp files)

4. **errors**
   - authentication failures
   - ffmpeg errors
   - timeout errors
   - 413 file too large

### fly.io metrics

```bash
# view metrics dashboard
fly dashboard -a plyr-transcoder

# check recent requests
fly logs -a plyr-transcoder | grep "POST /transcode"

# monitor resource usage
fly vm status -a plyr-transcoder
```

## troubleshooting

### common issues

**ffmpeg not found**:
```
error: ffmpeg command failed: No such file or directory
```
solution: ensure ffmpeg is installed in docker image (check Dockerfile)

**authentication fails in production**:
```
error: 401 unauthorized
```
solution: verify `TRANSCODER_AUTH_TOKEN` is set on both transcoder and backend

**timeouts on large files**:
```
error: request timeout after 120s
```
solution: increase timeout in backend client (`timeout=300.0`)

**413 entity too large**:
```
error: 413 payload too large
```
solution: increase `TRANSCODER_MAX_UPLOAD_BYTES` or reject large files earlier

**VM not starting automatically**:
```
error: no instances available
```
solution: check `auto_start_machines = true` in fly.toml

## future enhancements

### potential improvements

1. **progress tracking**
   - stream ffmpeg progress updates
   - return progress via server-sent events
   - enable client-side progress bar

2. **format detection**
   - auto-detect input format via ffprobe
   - validate format before transcoding
   - reject unsupported formats early

3. **quality presets**
   - high quality (320kbps MP3, 256kbps AAC)
   - standard quality (192kbps)
   - low quality (128kbps for previews)

4. **metadata preservation**
   - extract metadata from input
   - apply metadata to output
   - handle artwork/cover images

5. **batch processing**
   - accept multiple files
   - process in parallel
   - return as zip archive

6. **caching**
   - cache transcoded files by content hash
   - serve cached versions instantly
   - implement LRU eviction

## references

- source code: `transcoder/src/main.rs`
- justfile: `transcoder/Justfile`
- fly config: `transcoder/fly.toml`
- dockerfile: `transcoder/Dockerfile`
- ffmpeg docs: https://ffmpeg.org/documentation.html
- fly.io docs: https://fly.io/docs/
