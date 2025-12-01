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

### now-playing API for teal.fm/Piper integration (PR #416, Dec 1, 2025)

**motivation**: enable Piper (teal.fm) to display what users are currently listening to on plyr.fm

**what shipped**:
- **now-playing endpoint** (`GET /now-playing/{did}`):
  - returns currently playing track for a given user DID
  - includes track metadata (title, artist, album, cover art)
  - includes playback position and timestamp
  - public endpoint (no auth required)
  - returns 404 when user isn't playing anything
- **playback tracking**:
  - stores last playback state in `now_playing` table
  - updated when users interact with player
  - includes track_id, position, timestamp, user DID
- **privacy considerations**:
  - opt-in via user preferences (future enhancement)
  - currently public for all users who play tracks
  - DIDs are already public identifiers

**impact**:
- enables cross-platform integrations (Piper can show "listening to X on plyr.fm")
- lays groundwork for richer presence features
- demonstrates plyr.fm as an API-first platform

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

this is a living document. last updated 2025-12-01 after ATProto labeler work.

older history has been archived to .status_history/ directory.
