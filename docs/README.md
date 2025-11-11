# plyr.fm documentation

this directory contains all documentation for the plyr.fm project.

## architecture

### [`architecture/global-state-management.md`](./architecture/global-state-management.md)

**state management** - how plyr.fm manages global state with Svelte 5 runes.

covers:
- toast notification system
- tracks cache with event-driven invalidation
- upload manager with fire-and-forget pattern
- queue management with server sync
- liked tracks cache
- preferences state
- optimistic UI patterns for auth state
- localStorage persistence

## design

### [`design/toast-notifications.md`](./design/toast-notifications.md)

**toast notifications** - user feedback system for async operations.

covers:
- toast state manager with smooth transitions
- in-place updates for progress changes
- auto-dismiss with configurable duration
- type safety with TypeScript

### [`design/streaming-uploads.md`](./design/streaming-uploads.md)

**streaming uploads** - SSE-based progress tracking for file uploads.

covers:
- fire-and-forget upload pattern
- Server-Sent Events (SSE) for real-time progress
- background processing with asyncio
- upload state management

## observability

### [`logfire-querying.md`](./logfire-querying.md)

**logfire queries** - patterns for querying traces and spans.

covers:
- SQL query patterns for Logfire DataFusion database
- finding exceptions and errors
- analyzing performance bottlenecks
- filtering by trace context
- common debugging queries

## deployment

### [`deployment/overview.md`](./deployment/overview.md)

**deployment guide** - how plyr.fm deploys to production.

covers:
- cloudflare pages (frontend)
- fly.io (backend and transcoder)
- automated deployments via github
- preview deployments and CORS
- environment variables and secrets
- troubleshooting common deployment issues

### [`deployment/database-migrations.md`](./deployment/database-migrations.md)

**database migrations** - how database schema changes are managed.

covers:
- automated migration workflow via fly.io release commands
- database environment architecture (dev vs prod)
- creating and testing migrations with alembic
- how database connection resolution works
- future improvements for multi-environment setup
- migration safety and rollback procedures

## features

### [`features/liked-tracks.md`](./features/liked-tracks.md)

**liked tracks** - ATProto-backed track likes with error handling.

covers:
- fm.plyr.like record creation and deletion
- database and ATProto consistency guarantees
- cleanup and rollback logic for failed operations
- batch like status queries
- frontend like button component
- idempotent like/unlike operations

## services

### [`services/transcoder.md`](./services/transcoder.md)

**audio transcoder** - rust-based HTTP service for audio format conversion.

covers:
- ffmpeg integration for format conversion
- authentication and security
- fly.io deployment
- API endpoints and usage
- integration with main backend
- supported formats and codecs

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
- ✅ R2 storage for audio files (cloudflare CDN)
- ✅ track upload with streaming (prevents OOM)
- ✅ ATProto record creation (fm.plyr.track namespace)
- ✅ music player with queue management
- ✅ liked tracks (fm.plyr.like namespace)
- ✅ artist pages and track discovery
- ✅ image uploads for track artwork
- ✅ audio transcoding service (rust + ffmpeg)
- ✅ server-sent events for upload progress
- ✅ toast notifications
- ✅ user preferences (accent color, auto-play)

### local development

```bash
# backend
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001

# frontend
cd frontend && bun run dev

# transcoder (optional)
cd transcoder && just run
```

### deployment

see [`deployment/overview.md`](./deployment/overview.md) for details on:
- staging vs production environments
- automated deployment via github actions
- database migrations
- environment variables and secrets

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

**enforced by relay**: tracks are associated with `artist_did` and only owner can delete

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
