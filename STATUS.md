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

## recent work

### now-playing API (PR #416, Dec 1, 2025)

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

### admin UI improvements for moderation (PRs #408-414, Dec 1, 2025)

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

### ATProto labeler and admin UI improvements (PRs #385-395, Nov 29-Dec 1, 2025)

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

### critical bugs
1. **upload reliability** (issue #147): upload returns 200 but file missing from R2, no error logged
   - priority: high (data loss risk)
   - need better error handling and retry logic in background upload task

2. **database connection pool SSL errors**: intermittent failures on first request
   - symptom: `/tracks/` returns 500 on first request, succeeds after
   - fix: set `pool_pre_ping=True`, adjust `pool_recycle` for Neon timeouts
   - documented in `docs/logfire-querying.md`

---

## technical state

### what's working

**core functionality**
- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ secure session management via HttpOnly cookies (XSS protection)
- ✅ developer tokens with independent OAuth grants (programmatic API access)
- ✅ platform stats endpoint and homepage display (plays, tracks, artists)
- ✅ Media Session API for CarPlay, lock screens, control center
- ✅ timed comments on tracks with clickable timestamps
- ✅ account deletion with explicit confirmation
- ✅ artist profiles synced with Bluesky (avatar, display name, handle)
- ✅ track upload with streaming to prevent OOM
- ✅ track edit (title, artist, album, features metadata)
- ✅ track deletion with cascade cleanup
- ✅ audio streaming via HTML5 player with 307 redirects to R2 CDN
- ✅ track metadata published as ATProto records (fm.plyr.track namespace)
- ✅ play count tracking with threshold (30% or 30s, whichever comes first)
- ✅ like functionality with counts
- ✅ artist analytics dashboard
- ✅ queue management (shuffle, auto-advance, reorder)
- ✅ mobile-optimized responsive UI
- ✅ cross-tab queue synchronization via BroadcastChannel
- ✅ share tracks via URL with Open Graph previews (including cover art)
- ✅ image URL caching in database (eliminates N+1 R2 calls)
- ✅ format validation (rejects AIFF/AIF, accepts MP3/WAV/M4A with helpful error messages)
- ✅ standalone audio transcoding service deployed and verified (see issue #153)
- ✅ admin content moderation script for removing inappropriate uploads
- ✅ copyright moderation system (AuDD fingerprinting, review workflow, violation tracking)
- ✅ ATProto labeler for copyright violations (queryLabels, subscribeLabels XRPC endpoints)
- ✅ admin UI for reviewing flagged tracks with htmx (plyr-moderation.fly.dev/admin)

**albums**
- ✅ album database schema with track relationships
- ✅ album browsing pages (`/u/{handle}` shows discography)
- ✅ album detail pages (`/u/{handle}/album/{slug}`) with full track lists
- ✅ album cover art upload and display
- ✅ server-side rendering for SEO
- ✅ rich Open Graph metadata for link previews (music.album type)
- ✅ long album title handling (100-char slugs, CSS truncation)
- ⏸ ATProto records for albums (deferred, see issue #221)

**deployment (fully automated)**
- **production**:
  - frontend: https://plyr.fm (cloudflare pages)
  - backend: https://relay-api.fly.dev (fly.io: 2 machines, 1GB RAM, 1 shared CPU, min 1 running)
  - database: neon postgresql
  - storage: cloudflare R2 (audio-prod and images-prod buckets)
  - deploy: github release → automatic

- **staging**:
  - backend: https://api-stg.plyr.fm (fly.io: relay-api-staging)
  - frontend: https://stg.plyr.fm (cloudflare pages: plyr-fm-stg)
  - database: neon postgresql (relay-staging)
  - storage: cloudflare R2 (audio-stg bucket)
  - deploy: push to main → automatic

### known issues

**player behavior**
- playback auto-start on refresh (#225)
  - sometimes plays immediately after page load
  - investigating localStorage/queue state persistence
  - may not respect `autoplay_next` preference in all scenarios

**missing features**
- no ATProto records for albums yet (#221 - consciously deferred)
- no track genres/tags/descriptions yet (#155)
- no AIFF/AIF transcoding support (#153)
- no PWA installation prompts (#165)
- no fullscreen player view (#122)
- no public API for third-party integrations (#56)

---

## cost structure

current monthly costs: ~$5-6

- cloudflare pages: $0 (free tier)
- cloudflare R2: ~$0.16 (storage + operations, no egress fees)
- fly.io production: $5.00 (2x shared-cpu-1x VMs with auto-stop)
- fly.io staging: $0 (auto-stop, only runs during testing)
- neon: $0 (free tier, 0.5 CPU, 512MB RAM, 3GB storage)
- logfire: $0 (free tier)
- domain: $12/year (~$1/month)

## deployment URLs

- **production frontend**: https://plyr.fm
- **production backend**: https://relay-api.fly.dev (redirects to https://api.plyr.fm)
- **staging backend**: https://api-stg.plyr.fm
- **staging frontend**: https://stg.plyr.fm
- **repository**: https://github.com/zzstoatzz/plyr.fm (private)
- **monitoring**: https://logfire-us.pydantic.dev/zzstoatzz/relay
- **bluesky**: https://bsky.app/profile/plyr.fm
- **latest release**: 2025.1129.214811

## health indicators

**production status**: ✅ healthy
- uptime: consistently available
- response times: <500ms p95 for API endpoints
- error rate: <1% (mostly invalid OAuth states)
- storage: ~12 tracks uploaded, functioning correctly

**key metrics**
- total tracks: ~12
- total artists: ~3
- play counts: tracked per-track
- storage used: <1GB R2
- database size: <10MB postgres

---

this is a living document. last updated 2025-12-02 after status maintenance.
