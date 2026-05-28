---
title: "audio transcoder service"
---

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

**supported target formats** (`?target=`):
- `mp3` (libmp3lame, 320 kbps CBR) — the canonical streaming rendition produced by the deferred optimize task
- `wav` (pcm_s16le, source rate/channels preserved) — the fast compatibility remux used on the publish path
- `m4a` (AAC, 256 kbps) — available but not currently exercised by the backend

source formats accepted on `file`: anything ffmpeg can decode (commonly aiff, flac, wav, m4a, mp3).

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
5. **run ffmpeg**: spawn ffmpeg, wait for completion (writes to an on-disk temp output so WAV/M4A get correct container headers)
6. **stream output file**: open the temp output and serve it as the response body in chunks via `ReaderStream` — at no point does the service hold the whole transcoded blob in memory (a ~900 MB WAV remux would OOM the 1 GB machine otherwise)
7. **cleanup**: drop the `TempDir`; the open output fd survives the unlink so the stream finishes reading from the now-unlinked-but-still-open file (standard Unix trick)

### ffmpeg command

the service constructs ffmpeg commands based on target format:

```bash
# MP3 (canonical streaming rendition; produced by the deferred optimize task)
ffmpeg -y -i input.aif -acodec libmp3lame -b:a 320k -ar 44100 output.mp3

# WAV (fast compatibility remux on the publish path; source rate/channels preserved)
ffmpeg -y -i input.aif -acodec pcm_s16le output.wav

# M4A (AAC; available but not currently exercised by the backend)
ffmpeg -y -i input.wav -acodec aac -b:a 256k -ar 44100 output.m4a
```

**why no `-ar` on WAV**: the WAV path is a compatibility *remux* — the goal is a 16-bit container that plays everywhere, not a re-sample. preserving the source sample rate keeps it a near-instant PCM rewrap (e.g. AIFF `pcm_s16be` → WAV `pcm_s16le` is a byte-swap), instead of a full resample.

### codec selection

| target | codec | container | use |
|--------|-------|-----------|-----|
| mp3 | libmp3lame | MPEG | canonical streaming rendition (deferred optimize) |
| wav | pcm_s16le | WAV | fast compatibility remux on the publish path |
| m4a | aac | MP4 | available but not currently used |

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
cd services/transcoder && fly deploy

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

the transcoder is integrated into the upload pipeline for AIFF (the only currently-supported lossless format that isn't browser-playable — FLAC, WAV, M4A, MP3 are all served as-is without transcoding). publishing is **decoupled** from MP3 optimization so a long lossless source doesn't block the upload on a multi-minute single-threaded encode:

1. **publish path (fast, on critical path)**: the worker remuxes the staged AIFF → **16-bit WAV** via the transcoder (`target=wav` — a near-instant PCM rewrap, not an MP3 encode). The track is created and playable in every browser within seconds. The audio is served from R2 (`audioUrl`); **no PDS blob is written at this stage**.
2. **optimize task (deferred, off critical path)**: a background task (`backend.api.tracks.audio_optimize`) reads the lossless original, transcodes it to **MP3** via the transcoder (`target=mp3`, generous timeout), uploads the MP3 to the user's PDS as the single canonical `audioBlob`, rebuilds the `fm.plyr.track` record (preserving `createdAt`), atomically swaps the playable rendition to MP3 (CAS to refuse if a concurrent `audio_replace` moved the audio under us), and deletes the interim WAV.
3. **export**: returns the lossless `original_file_id` so the user always has their master.

so the transcoder is called in two distinct modes:

| mode | target | called from | typical duration | timeout (`settings.transcoder`) | reaped by stuck-upload reaper? |
|------|--------|-------------|------------------|---------------------------------|---------------------------------|
| publish remux | `wav` | `_store_audio` (`api.tracks.uploads`) | seconds | `timeout_seconds` (default 600s) | yes — `type=upload` jobs |
| deferred optimize | `mp3` | `optimize_track_audio` (`api.tracks.audio_optimize`) | minutes (1-CPU encode) | `optimize_timeout_seconds` (default 3600s) | no — `type=optimize` jobs are out of the reaper's scope |

failure of the deferred optimize is safe: the track stays on its WAV rendition (fully consistent — R2 row, DB row, and PDS record all agree on the WAV `audioUrl`), and docket retries via `ExponentialRetry`. once the swap commits, the PDS record references the MP3 blob and the interim WAV is cleaned up.

### backend configuration

transcoder settings in `src/backend/config.py`:

```python
class TranscoderSettings(AppSettingsSection):
    """Transcoder service configuration for lossless audio conversion."""

    enabled: bool = True  # set to False to reject lossless uploads
    service_url: AnyHttpUrl = "https://plyr-transcoder.fly.dev"
    auth_token: str = ""  # set via TRANSCODER_AUTH_TOKEN env var
    timeout_seconds: int = 600          # request-blocking remux on the publish path
    optimize_timeout_seconds: int = 3600  # generous; deferred MP3 has no user waiting
    target_format: str = "mp3"
```

environment variables:
- `TRANSCODER_ENABLED`: enable/disable transcoding (default: true)
- `TRANSCODER_SERVICE_URL`: transcoder service URL
- `TRANSCODER_AUTH_TOKEN`: bearer token for authentication
- `TRANSCODER_TIMEOUT_SECONDS`: per-request timeout for the publish-path WAV remux
- `TRANSCODER_OPTIMIZE_TIMEOUT_SECONDS`: per-request timeout for the deferred MP3 encode

### calling from backend

the backend never holds the full transcoded file in memory — it streams the request body to the transcoder and streams the response body to a worker-local temp file, then streams that temp file into R2:

```python
client = get_transcoder_client()
result = await client.transcode_file(
    source_path,          # local path of the staged source (streamed from R2)
    source_format,        # e.g. "aiff"
    output_path=output_path,
    target_format="wav",  # "wav" on the publish path, "mp3" on the deferred optimize
    heartbeat=transcode_heartbeat,  # ticks jobs.updated_at so the reaper trusts liveness
)
```

`TranscoderClient.transcode_file` POSTs the file as multipart, then reads the response with `httpx.AsyncClient.stream(...)` and writes it chunk-by-chunk to `output_path` via `aiofiles`. the heartbeat fires on each chunk received (throttled to every 5s or every 10MB).

### error handling

`_transcode_audio` (in `api.tracks.uploads`) catches the typical failure modes and marks the job FAILED with detail before returning `None`:

- `httpx.TimeoutException` — surfaced as `"transcode timed out after Ns"`
- `httpx.HTTPStatusError` — surfaced with the response body (truncated)
- unexpected exceptions — surfaced via `logfire.error(..., exc_info=True)`

the **publish path** treats a `None` return as a failed upload (the track is never created; the user re-tries). the **deferred optimize task** treats a `None` return as a *transient* failure and re-raises so docket retries with exponential backoff — a true source-level failure would also have failed the publish-path WAV remux, which it didn't. terminal aborts (track removed, track moved on under us, session gone, already optimized) raise `_OptimizeAbort` and are swallowed so docket does not retry them.

## local development

### prerequisites

- rust toolchain (install via `rustup`)
- ffmpeg (install via `brew install ffmpeg` on macOS)

### running locally

```bash
# from transcoder directory
cd services/transcoder && cargo run

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

WAV remux (publish path — PCM rewrap, not a re-encode; effectively I/O-bound):
- 3-min AIFF (30 MB) → WAV: ~1 sec
- 10-min AIFF (100 MB) → WAV: ~2 sec
- 90-min AIFF (~900 MB) → WAV: ~5–10 sec

MP3 encode (deferred optimize path — single-threaded libmp3lame, CPU-bound):
- 3-min AIFF (30 MB) → MP3: ~5–10 sec
- 10-min AIFF (100 MB) → MP3: ~30–60 sec
- 90-min AIFF (~900 MB) → MP3: ~10–15 min (the case that motivated the decoupling — see `optimize_timeout_seconds`)

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

- source code: `services/transcoder/src/main.rs`
- justfile: `services/transcoder/justfile`
- fly config: `services/transcoder/fly.toml`
- dockerfile: `services/transcoder/Dockerfile`
- ffmpeg docs: https://ffmpeg.org/documentation.html
- fly.io docs: https://fly.io/docs/
