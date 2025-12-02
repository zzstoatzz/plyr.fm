# plyr.fm - status

## long-term vision

### the problem

today's music streaming is fundamentally broken:
- spotify and apple music trap your data in proprietary silos
- artists pay distribution fees and streaming cuts to multiple gatekeepers
- listeners can't own their music collections - they rent them
- switching platforms means losing everything: playlists, play history, social connections

### the atproto solution

plyr.fm is built on the AT Protocol (the protocol powering Bluesky) and enables:
- **portable identity**: your music collection, playlists, and listening history belong to you, stored in your personal data server (PDS)
- **decentralized distribution**: artists publish directly to the network without platform gatekeepers
- **interoperable data**: any client can read your music records - you're not locked into plyr.fm
- **authentic social**: artist profiles are real ATProto identities with verifiable handles (@artist.bsky.social)

### the dream state

plyr.fm should become:

1. **for artists**: the easiest way to publish music to the decentralized web
   - upload once, available everywhere in the ATProto network
   - direct connection to listeners without platform intermediaries
   - real ownership of audience relationships

2. **for listeners**: a streaming platform where you actually own your data
   - your collection lives in your PDS, playable by any ATProto music client
   - switch between plyr.fm and other clients freely - your data travels with you
   - share tracks as native ATProto posts to Bluesky

3. **for developers**: a reference implementation showing how to build on ATProto
   - open source end-to-end example of ATProto integration
   - demonstrates OAuth, record creation, federation patterns
   - proves decentralized music streaming is viable

---

**started**: October 28, 2025 (first commit: `454e9bc` - relay MVP with ATProto authentication)

---

## recent work

### December 2025

#### connection pool resilience for Neon cold starts (Dec 2)

**incident**: ~5 minute API outage (01:55-02:00 UTC) - all requests returned 500 errors

**root cause**: Neon serverless cold start after 5 minutes of idle traffic
- queue listener heartbeat detected dead connection, began reconnection
- first 5 user requests each held a connection waiting for Neon to wake up (3-5 min each)
- with pool_size=5 and max_overflow=0, pool exhausted immediately
- all subsequent requests got `QueuePool limit of size 5 overflow 0 reached`

**fix**:
- increased `pool_size` from 5 → 10 (handle more concurrent cold start requests)
- increased `max_overflow` from 0 → 5 (allow burst to 15 connections)
- increased `connection_timeout` from 3s → 10s (wait for Neon wake-up)

**related**: this is a recurrence of the Nov 17 incident. that fix addressed the queue listener's asyncpg connection but not the SQLAlchemy pool connections.

**documentation**: updated `docs/backend/database/connection-pooling.md` with Neon serverless considerations and incident history.

---

#### now-playing API (PR #416, Dec 1)

**motivation**: expose what users are currently listening to via public API

**what shipped**:
- `GET /now-playing/{did}` and `GET /now-playing/by-handle/{handle}` endpoints
- returns track metadata, playback position, timestamp
- 204 when nothing playing, 200 with track data otherwise
- public endpoints (no auth required) - DIDs are already public identifiers

**speculative integration with teal.fm**:
- opened draft PR to Piper (teal.fm's scrobbling service): https://github.com/teal-fm/piper/pull/27
- adds plyr.fm as a source alongside Spotify and Last.fm
- tested end-to-end: plyr.fm → Piper → ATProto PDS (actor.status records)
- **status**: awaiting feedback from teal.fm team
- **alternative approach suggested**: teal.fm team suggested plyr.fm could write directly to `fm.teal.*` lexicons
  - concern: this couples plyr.fm to teal's internal schema - if they change lexicons, we'd need to fast-follow
  - Piper approach keeps cleaner boundaries: plyr.fm exposes API, Piper handles teal.fm integration
  - decision pending further discussion with teal.fm maintainers

---

#### admin UI improvements for moderation (PRs #408-414, Dec 1)

**motivation**: improve usability of copyright moderation admin UI based on real-world usage

**what shipped**:
- **reason selection for false positives** (PR #408):
  - dropdown menu when marking tracks as false positive
  - options: "fingerprint noise", "original artist", "fair use", "other"
  - stores reason in `review_notes` field
  - multi-step confirmation to prevent accidental clicks
- **UI polish** (PR #414):
  - artist/track links open in new tabs for easy verification
  - better visual hierarchy and spacing
  - improved button states and hover effects
- **AuDD score normalization** (PR #413):
  - AuDD enterprise returns scores as 0-100 range (not 0-1)
  - added score display to admin UI for transparency
  - filter controls to show only high-confidence matches
- **form submission fix** (PR #412):
  - switched from FormData to URLSearchParams
  - fixes htmx POST request encoding
  - ensures resolution actions work correctly

**impact**:
- faster moderation workflow (one-click access to verify tracks)
- better audit trail (reasons tracked for false positive resolutions)
- more transparent (shows match confidence scores)
- more reliable (form submission works consistently)

---

### November 2025

#### ATProto labeler and admin UI (PRs #385-395, Nov 29-Dec 1)

**motivation**: integrate with ATProto labeling protocol for proper copyright violation signaling, and improve admin tooling for reviewing flagged content.

**what shipped**:
- **ATProto labeler implementation** (PRs #385, #391):
  - standalone labeler service integrated into moderation Rust service
  - implements `com.atproto.label.queryLabels` and `subscribeLabels` XRPC endpoints
  - k256 ECDSA signing for cryptographic label verification
  - SQLite storage for labels with sequence numbers
  - labels emitted when copyright violations detected
  - negation labels for false positive resolution
- **admin UI** (PRs #390, #392, #395):
  - web interface at `/admin` for reviewing copyright flags
  - htmx for server-rendered interactivity (no inline JS bloat)
  - static files extracted to `moderation/static/` for proper syntax highlighting
  - plyr.fm design tokens for brand consistency
  - shows track title, artist handle, match scores, and potential matches
  - "mark false positive" button emits negation label
- **label context enrichment** (PR #392):
  - labels now include track_title, artist_handle, artist_did, highest_score, matches
  - backfill script (`scripts/backfill_label_context.py`) populated 25 existing flags
  - admin UI displays rich context instead of just ATProto URIs
- **copyright flag visibility** (PRs #387, #389):
  - artist portal shows copyright flag indicator on flagged tracks
  - tooltip shows primary match (artist - title) for quick context
- **documentation** (PR #386):
  - comprehensive docs at `docs/moderation/atproto-labeler.md`
  - covers architecture, label schema, XRPC protocol, signing keys

**admin UI architecture**:
- `moderation/static/admin.html` - page structure
- `moderation/static/admin.css` - plyr.fm design tokens
- `moderation/static/admin.js` - auth handling (~40 lines)
- htmx endpoints: `/admin/flags-html`, `/admin/resolve-htmx`
- server-rendered HTML partials for flag cards

---

**earlier November work**: archived in [.status_history/2025-11.md](.status_history/2025-11.md)

---

## immediate priorities

### high priority features
1. **audio transcoding pipeline integration** (issue #153)
   - ✅ standalone transcoder service deployed at https://plyr-transcoder.fly.dev/
   - ✅ Rust/Axum service with ffmpeg, tested with 85-minute files
   - ✅ secure auth via X-Transcoder-Key header
   - ⏳ next: integrate into plyr.fm upload pipeline
     - backend calls transcoder API for unsupported formats
     - queue-based job system for async processing
     - R2 integration (fetch original, store MP3)
     - maintain original file hash for deduplication
     - handle transcoding failures gracefully

### open issues

**immediate**:
- issue #153: audio transcoding pipeline (ffmpeg worker for AIFF/FLAC→MP3)

**short-term**:
- issue #146: content-addressable storage (hash-based deduplication)
- issue #24: implement play count abuse prevention

**medium-term**:
- issue #221: first-class albums (ATProto records)
- issue #393: moderation - represent confirmed takedown state in labeler
- issue #373: lyrics field and Genius-style annotations

---

## technical overview

### what's working

- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats endpoint and homepage display
- ✅ Media Session API for CarPlay, lock screens, control center
- ✅ timed comments on tracks with clickable timestamps
- ✅ track upload/edit/delete with streaming
- ✅ play count tracking and like functionality
- ✅ queue management (shuffle, auto-advance, reorder)
- ✅ mobile-optimized responsive UI
- ✅ copyright moderation system (AuDD fingerprinting, ATProto labeler)
- ✅ admin UI for reviewing flagged tracks (plyr-moderation.fly.dev/admin)

### deployment

- **production**: https://plyr.fm (backend: relay-api.fly.dev)
- **staging**: https://stg.plyr.fm (backend: api-stg.plyr.fm)
- **ci/cd**: GitHub Actions (automatic deploys)
- **latest release**: 2025.1129.214811

### stack

- **backend**: Python/FastAPI, Neon PostgreSQL, Cloudflare R2, Fly.io
- **frontend**: SvelteKit (Svelte 5 runes), Bun, Cloudflare Pages
- **moderation**: Rust/Axum service (ATProto labeler, AuDD integration)
- **observability**: Pydantic Logfire

---

this is a living document. last updated 2025-12-02.
