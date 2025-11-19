# plyr.fm documentation

this directory contains all documentation for the plyr.fm project.

## documentation index

### authentication & security
- **[authentication.md](./authentication.md)** - secure cookie-based authentication, HttpOnly cookies, XSS protection, environment architecture, migration from localStorage

### frontend
- **[state-management.md](./frontend/state-management.md)** - global state management with Svelte 5 runes (toast notifications, tracks cache, upload manager, queue management, liked tracks, preferences, localStorage persistence)
- **[toast-notifications.md](./frontend/toast-notifications.md)** - user feedback system for async operations with smooth transitions and auto-dismiss
- **[queue.md](./frontend/queue.md)** - music queue management with server sync
- **[keyboard-shortcuts.md](./frontend/keyboard-shortcuts.md)** - global keyboard shortcuts with context-aware filtering (Q for queue toggle, patterns for adding new shortcuts)

### backend
- **[configuration.md](./backend/configuration.md)** - backend configuration and environment setup
- **[liked-tracks.md](./backend/liked-tracks.md)** - ATProto-backed track likes with error handling and consistency guarantees
- **[streaming-uploads.md](./backend/streaming-uploads.md)** - SSE-based progress tracking for file uploads with fire-and-forget pattern
- **[transcoder.md](./backend/transcoder.md)** - rust-based HTTP service for audio format conversion (ffmpeg integration, authentication, fly.io deployment)

### deployment
- **[environments.md](./deployment/environments.md)** - staging vs production environments, automated deployment via GitHub Actions, CORS, secrets management
- **[database-migrations.md](./deployment/database-migrations.md)** - automated migration workflow via fly.io release commands, alembic usage, safety procedures

### tools
- **[logfire.md](./tools/logfire.md)** - SQL query patterns for Logfire DataFusion database, finding exceptions, analyzing performance bottlenecks
- **[neon.md](./tools/neon.md)** - Neon Postgres database management and best practices
- **[pdsx.md](./tools/pdsx.md)** - ATProto PDS explorer and debugging tools

### local development
- **[setup.md](./local-development/setup.md)** - complete local development setup guide

## ATProto integration

plyr.fm uses a hybrid storage model:
- audio files stored in cloudflare R2 (scalable, CDN-backed)
- metadata stored as ATProto records on user's PDS (decentralized, user-owned)
- local database indexes for fast queries

key namespaces:
- `fm.plyr.track` - track metadata (title, artist, album, features, image, audio file reference)
- `fm.plyr.like` - user likes on tracks (subject references track URI)

## quick start

### current state

plyr.fm is fully functional with:
- ✅ OAuth 2.1 authentication (ATProto)
- ✅ secure cookie-based sessions (HttpOnly, XSS protection)
- ✅ R2 storage for audio files (cloudflare CDN)
- ✅ track upload with streaming (prevents OOM)
- ✅ ATProto record creation (fm.plyr.track namespace)
- ✅ music player with queue management
- ✅ liked tracks (fm.plyr.like namespace)
- ✅ artist pages and track discovery
- ✅ share buttons across track, album, and artist detail pages for quick copy-to-clipboard links
- ✅ image uploads for track artwork
- ✅ audio transcoding service (rust + ffmpeg)
- ✅ server-sent events for upload progress
- ✅ toast notifications
- ✅ user preferences (accent color, auto-play)
- ✅ keyboard shortcuts (Q for queue toggle)

### local development

see **[local-development/setup.md](./local-development/setup.md)** for complete setup instructions.

quick start:
```bash
# backend
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001

# frontend
cd frontend && bun run dev

# transcoder (optional)
cd transcoder && just run
```

### deployment

see **[deployment/environments.md](./deployment/environments.md)** for details on:
- staging vs production environments
- automated deployment via GitHub Actions
- environment variables and secrets

see **[deployment/database-migrations.md](./deployment/database-migrations.md)** for:
- migration workflow and safety procedures
- alembic usage and testing

## architecture decisions

### why R2 instead of PDS blobs?

PDS blobs are designed for smaller files like images. audio files are:
- larger (5-50MB per track)
- require streaming
- benefit from CDN distribution

R2 provides:
- scalable storage
- free egress to cloudflare CDN
- simple HTTP URLs
- cost-effective (~$0.015/GB/month)

### why fm.plyr namespace?

plyr.fm uses `fm.plyr.*` as the ATProto namespace:
- `fm.plyr.track` for track metadata
- `fm.plyr.like` for user likes

this is a domain-specific lexicon that allows:
- clear ownership and governance
- faster iteration without formal approval
- alignment with the plyr.fm brand

### why hybrid storage?

storing metadata on ATProto provides:
- user data sovereignty (users own their catalog)
- decentralization (no single point of failure)
- portability (users can move to another client)

storing audio on R2 provides:
- performance (fast streaming via CDN)
- scalability (handles growth)
- cost efficiency (cheaper than PDS blobs)

### why separate transcoder service?

the transcoder runs as a separate rust service because:
- ffmpeg operations are CPU-intensive and can block event loop
- rust provides better performance for media processing
- isolation prevents transcoding from affecting API latency
- can scale independently from main backend

## testing

plyr.fm uses pytest for backend testing:

```bash
# run all tests
just test

# run specific test file
just test tests/api/test_track_likes.py

# run with verbose output
just test -v
```

test categories:
- API endpoints (`tests/api/`)
- storage backends (`tests/storage/`)
- ATProto integration (`tests/test_atproto.py`)
- audio format validation (`tests/test_audio_formats.py`)

see [`tests/CLAUDE.md`](../tests/CLAUDE.md) for testing guidelines.

## troubleshooting

### R2 upload fails

```
error: failed to upload to R2
```

**check**:
- R2 credentials in `.env`
- bucket exists and is accessible
- account ID is correct

### ATProto record creation fails

```
error: failed to create atproto record
```

**check**:
- OAuth session is valid (not expired)
- user has write permissions
- PDS is accessible
- record format is valid

### audio won't play

```
404: audio file not found
```

**check**:
- `STORAGE_BACKEND` matches actual storage
- R2 bucket has public read access
- file_id matches database record

## monitoring

### key metrics to track

1. **upload success rate**
   - total uploads attempted
   - successful R2 uploads
   - successful record creations

2. **storage costs**
   - total R2 storage (GB)
   - monthly operations count
   - estimated cost

3. **playback metrics**
   - tracks played
   - average stream duration
   - errors/failures

### logging

add structured logging for debugging:

```python
import structlog

logger = structlog.get_logger()

logger.info(
    "track_uploaded",
    track_id=track.id,
    r2_url=r2_url,
    atproto_uri=atproto_uri,
)
```

## security considerations

### audio file access

**current**: R2 URLs are public (anyone with URL can access)

**acceptable for MVP** because:
- music is meant to be shared
- no sensitive content
- URL guessing is impractical (content-based hashes)

**future enhancement**: signed URLs with expiration

### record ownership

**enforced by ATProto**: only user with valid OAuth session can create records in their repo

**enforced by backend**: tracks are associated with `artist_did` and only owner can delete

### rate limiting

**recommended**: limit uploads to prevent abuse
- 10 uploads per hour per user
- 100MB total per hour per user

## cost estimates

current monthly costs (~$15-20/month):
- fly.io backend: $5-10/month (shared-cpu-1x, 256MB RAM)
- fly.io transcoder: $5-10/month (shared-cpu-1x, 256MB RAM)
- neon postgres: free tier (0.5GB storage, 3GB data transfer)
- cloudflare R2: ~$0.16/month (6 buckets: audio-dev, audio-stg, audio-prod, images-dev, images-stg, images-prod)
- cloudflare pages: free (frontend hosting)

R2 storage scaling (audio + images):
- 1,000 tracks: ~$0.16/month
- 10,000 tracks: ~$1.58/month
- 100,000 tracks: ~$15.81/month

## references

### ATProto documentation

- [repository spec](https://atproto.com/specs/repository)
- [lexicon spec](https://atproto.com/specs/lexicon)
- [data model](https://atproto.com/specs/data-model)
- [OAuth 2.1](https://atproto.com/specs/oauth)

### cloudflare documentation

- [R2 overview](https://developers.cloudflare.com/r2/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/)

### plyr.fm project files

- project instructions: `CLAUDE.md`
- main readme: `README.md`
- justfile: `justfile` (task runner)
- backend: `src/backend/`
- frontend: `frontend/`
- transcoder: `transcoder/`

## contributing

when working on plyr.fm:

1. **test empirically first** - run code and prove it works
2. **reference existing docs** - check docs directory before researching
3. **keep it simple** - MVP over perfection
4. **use lowercase** - respect plyr.fm's aesthetic
5. **no sprawl** - avoid creating multiple versions of files
6. **document decisions** - update docs as you work

## questions?

if anything is unclear:
- check the relevant phase document
- review example projects in sandbox
- consult ATProto official docs
- look at your atproto fork implementation
