# relay ATProto integration documentation

this directory contains the complete plan and implementation guides for integrating relay with ATProto.

## documents

### [`atproto-integration-plan.md`](./atproto-integration-plan.md)

**overview document** - read this first to understand the overall architecture and approach.

covers:
- hybrid storage model (R2 + ATProto records)
- lexicon design for `app.relay.track`
- implementation phases
- data flow diagrams
- open questions and decisions

### [`phase1-r2-implementation.md`](./phase1-r2-implementation.md)

**R2 storage migration** - practical guide to moving from filesystem to cloudflare R2.

covers:
- R2 bucket setup and configuration
- implementation of `R2Storage` class
- migration strategies
- testing procedures
- cost estimates (~$0.16/month for 1000 tracks)

### [`phase2-atproto-records.md`](./phase2-atproto-records.md)

**ATProto record creation** - guide to writing track metadata to user's PDS.

covers:
- database schema updates
- `create_track_record()` implementation
- upload endpoint modifications
- error handling strategies
- frontend integration

## quick start

### current state (MVP)

relay is working with:
- ✅ OAuth 2.1 authentication (ATProto)
- ✅ filesystem storage for audio files
- ✅ track upload and playback
- ✅ basic music player

### next steps

#### immediate (phase 1)

migrate audio storage to R2:

1. set up R2 bucket in cloudflare
2. add credentials to `.env`
3. implement `R2Storage` class (see phase1 doc)
4. set `STORAGE_BACKEND=r2`
5. test upload and playback

**estimated effort**: 2-3 hours

#### near-term (phase 2)

add ATProto record creation:

1. update Track model with ATProto fields
2. create `atproto/records.py` module
3. modify upload endpoint to create records
4. test record creation on personal PDS
5. update frontend to show "published to ATProto" badge

**estimated effort**: 3-4 hours

#### future (phase 3)

implement discovery via firehose:

1. set up jetstream consumer
2. listen for `app.relay.track` commits
3. index discovered tracks
4. add discovery feed to frontend

**estimated effort**: 8-12 hours (deferred)

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

### why unofficial lexicon?

relay uses `app.relay.track` as an unofficial lexicon (similar to `app.at-me.visit`) because:
- faster iteration during development
- no formal governance needed for MVP
- can migrate to official lexicon later if needed

### why hybrid storage?

storing metadata on ATProto provides:
- user data sovereignty (users own their catalog)
- decentralization (no single point of failure)
- portability (users can move to another client)

storing audio on R2 provides:
- performance (fast streaming)
- scalability (handles growth)
- cost efficiency (cheaper than PDS blobs)

## testing strategy

### phase 1 testing

```bash
# 1. upload test file
curl -X POST http://localhost:8001/tracks/ \
  -H "Cookie: session_id=..." \
  -F "file=@test.mp3" \
  -F "title=test" \
  -F "artist=test"

# 2. verify R2 storage
# check cloudflare dashboard for file

# 3. test playback
# open frontend and play track
```

### phase 2 testing

```bash
# 1. upload and check record
curl -X POST http://localhost:8001/tracks/ ...
# response should include atproto_record_uri

# 2. verify on PDS
# use at-me or similar tool to view records

# 3. check record content
python scripts/check_record.py <record_uri>
```

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

## cost projections

### 1000 tracks (typical small catalog)

- storage: 10GB @ $0.015/GB = $0.15/month
- uploads: 1000 operations @ $4.50/million = $0.005
- streams: 10k plays @ $0.36/million = $0.004
- **total: ~$0.16/month**

### 10,000 tracks (medium platform)

- storage: 100GB @ $0.015/GB = $1.50/month
- uploads: 10k operations = $0.045
- streams: 100k plays = $0.036
- **total: ~$1.58/month**

### 100,000 tracks (large platform)

- storage: 1TB @ $0.015/GB = $15/month
- uploads: 100k operations = $0.45
- streams: 1M plays = $0.36
- **total: ~$15.81/month**

**note**: these are R2 costs only. add compute, database, etc.

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

### relay project files

- current status: `sandbox/status-2025-10-28.md`
- project instructions: `CLAUDE.md`
- atproto fork: `sandbox/atproto-fork/`
- example projects: `sandbox/at-me/`, `sandbox/status/`

## contributing

when implementing these plans:

1. **test empirically first** - run code and prove it works
2. **reference existing docs** - check sandbox directory before researching
3. **keep it simple** - MVP over perfection
4. **use lowercase** - respect relay's aesthetic
5. **no sprawl** - avoid creating multiple versions of files

## questions?

if anything is unclear:
- check the relevant phase document
- review example projects in sandbox
- consult ATProto official docs
- look at your atproto fork implementation
