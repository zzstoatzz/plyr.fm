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

### copyright moderation system (PRs #382, #384, Nov 29-30, 2025)

**motivation**: detect potential copyright violations in uploaded tracks to avoid DMCA issues and protect the platform.

**what shipped**:
- **moderation service** (Rust/Axum on Fly.io):
  - standalone service at `plyr-moderation.fly.dev`
  - integrates with AuDD enterprise API for audio fingerprinting
  - scans audio URLs and returns matches with metadata (artist, title, album, ISRC, timecode)
  - auth via `X-Moderation-Key` header
- **backend integration** (PR #382):
  - `ModerationSettings` in config (service URL, auth token, timeout)
  - moderation client module (`backend/_internal/moderation.py`)
  - fire-and-forget background task on track upload
  - stores results in `copyright_scans` table
  - scan errors stored as "clear" so tracks aren't stuck unscanned
- **flagging fix** (PR #384):
  - AuDD enterprise API returns no confidence scores (all 0)
  - changed from score threshold to presence-based flagging: `is_flagged = !matches.is_empty()`
  - removed unused `score_threshold` config
- **backfill script** (`scripts/scan_tracks_copyright.py`):
  - scans existing tracks that haven't been checked
  - `--max-duration` flag to skip long DJ sets (estimated from file size)
  - `--dry-run` mode to preview what would be scanned
  - supports dev/staging/prod environments
- **review workflow**:
  - `copyright_scans` table has `resolution`, `reviewed_at`, `reviewed_by`, `review_notes` columns
  - resolution values: `violation`, `false_positive`, `original_artist`
  - SQL queries for dashboard: flagged tracks, unreviewed flags, violations list

**initial review results** (25 flagged tracks):
- 8 violations (actual copyright issues)
- 11 false positives (fingerprint noise)
- 6 original artists (people uploading their own distributed music)

**key SQL queries**:
```sql
-- unreviewed flags
SELECT cs.track_id, t.title, a.handle, jsonb_array_length(cs.matches) as match_count,
       cs.matches->0->>'artist' as top_match_artist, cs.matches->0->>'title' as top_match_title
FROM copyright_scans cs
JOIN tracks t ON cs.track_id = t.id
JOIN artists a ON t.artist_did = a.did
WHERE cs.is_flagged = true AND cs.resolution IS NULL
ORDER BY match_count DESC;

-- all violations
SELECT cs.track_id, t.title, a.handle, cs.matches->0->>'artist' as matched_artist,
       cs.matches->0->>'title' as matched_title, cs.review_notes
FROM copyright_scans cs
JOIN tracks t ON cs.track_id = t.id
JOIN artists a ON t.artist_did = a.did
WHERE cs.resolution = 'violation'
ORDER BY cs.reviewed_at DESC;
```

**impact**:
- automated copyright detection on upload
- manual review workflow for flagged content
- protection against DMCA takedown requests
- clear audit trail with resolution status

---

### platform stats and media session integration (PRs #359-379, Nov 27-29, 2025)

**motivation**: show platform activity at a glance, improve playback experience across devices, and give users control over their data.

**what shipped**:
- **platform stats endpoint and UI** (PRs #376, #378, #379):
  - `GET /stats` returns total plays, tracks, and artists
  - stats bar displays in homepage header (e.g., "1,691 plays • 55 tracks • 8 artists")
  - skeleton loading animation while fetching
  - responsive layout: visible in header on wide screens, collapses to menu on narrow
  - end-of-list animation on homepage
- **Media Session API** (PR #371):
  - provides track metadata to CarPlay, lock screens, Bluetooth devices, macOS control center
  - artwork display with fallback to artist avatar
  - play/pause, prev/next, seek controls all work from system UI
  - position state syncs scrubbers on external interfaces
- **browser tab title** (PR #374):
  - shows "track - artist • plyr.fm" while playing
  - persists across page navigation
  - reverts to page title when playback stops
- **timed comments** (PR #359):
  - comments capture timestamp when added during playback
  - clickable timestamp buttons seek to that moment
  - compact scrollable comments section on track pages
- **constellation integration** (PR #360):
  - queries constellation.microcosm.blue backlink index
  - enables network-wide like counts (not just plyr.fm internal)
  - environment-aware namespace handling
- **account deletion** (PR #363):
  - explicit confirmation flow (type handle to confirm)
  - deletes all plyr.fm data (tracks, albums, likes, comments, preferences)
  - optional ATProto record cleanup with clear warnings about orphaned references

**impact**:
- platform stats give visitors immediate sense of activity
- media session makes plyr.fm tracks controllable from car/lock screen/control center
- timed comments enable discussion at specific moments in tracks
- account deletion gives users full control over their data

---

### developer tokens with independent OAuth grants (PR #367, Nov 28, 2025)

**motivation**: programmatic API access (scripts, CLIs, automation) needed tokens that survive browser logout and don't become stale when browser sessions refresh.

**what shipped**:
- **OAuth-based dev tokens**: each developer token gets its own OAuth authorization flow
  - user clicks "create token" → redirected to PDS for authorization → token created with independent credentials
  - tokens have their own DPoP keypair, access/refresh tokens - completely separate from browser session
- **cookie isolation**: dev token exchange doesn't set browser cookie
  - added `is_dev_token` flag to ExchangeToken model
  - /auth/exchange skips Set-Cookie for dev token flows
  - prevents logout from deleting dev tokens (critical bug fixed during implementation)
- **token management UI**: portal → "your data" → "developer tokens"
  - create with optional name and expiration (30/90/180/365 days or never)
  - list active tokens with creation/expiration dates
  - revoke individual tokens
- **API endpoints**:
  - `POST /auth/developer-token/start` - initiates OAuth flow, returns auth_url
  - `GET /auth/developer-tokens` - list user's tokens
  - `DELETE /auth/developer-tokens/{prefix}` - revoke by 8-char prefix

**CLI usage** (`scripts/plyr.py`):
```bash
# set token in environment
export PLYR_TOKEN="your_token_here"

# list tracks
PLYR_API_URL=https://api.plyr.fm uv run scripts/plyr.py list

# upload a track
PLYR_API_URL=https://api.plyr.fm uv run scripts/plyr.py upload track.mp3 "My Track"

# delete a track
PLYR_API_URL=https://api.plyr.fm uv run scripts/plyr.py delete 42 -y
```

**security properties**:
- tokens are full sessions with encrypted OAuth credentials (Fernet)
- each token refreshes independently (no staleness from browser session refresh)
- revokable individually without affecting browser or other tokens
- explicit OAuth consent required at PDS for each token created

**testing verified**:
- created token → uploaded track → logged out → deleted track with token ✓
- browser logout doesn't affect dev tokens ✓
- token works across browser sessions ✓
- staging deployment tested end-to-end ✓

**documentation**: see `docs/authentication.md` "developer tokens" section

---

### oEmbed endpoint for Leaflet.pub embeds (PRs #355-358, Nov 25, 2025)

**motivation**: plyr.fm tracks embedded in Leaflet.pub (via iframely) showed a black HTML5 audio box instead of our custom embed player.

**what shipped**:
- **oEmbed endpoint** (PR #355): `/oembed` returns proper embed HTML with iframe
  - follows oEmbed spec with `type: "rich"` and iframe in `html` field
  - discovery link in track page `<head>` for automatic detection
- **iframely domain registration**: registered plyr.fm on iframely.com (free tier)
  - this was the key fix - iframely now returns our embed iframe as `links.player[0]`
  - API key: stored in 1password (iframely account)

**debugging journey** (PRs #356-358):
- initially tried `og:video` meta tags to hint iframe embed - didn't work
- tried removing `og:audio` to force oEmbed fallback - resulted in no player link
- discovered iframely requires domain registration to trust oEmbed providers
- after registration, iframely correctly returns embed iframe URL

**current state**:
- oEmbed endpoint working: `curl https://api.plyr.fm/oembed?url=https://plyr.fm/track/92`
- iframely returns `links.player[0].href = "https://plyr.fm/embed/track/92"` (our embed)
- Leaflet.pub should show proper embeds (pending their cache expiry)

**impact**:
- plyr.fm tracks can be embedded in Leaflet.pub and other iframely-powered services
- proper embed player with cover art instead of raw HTML5 audio

---

### export & upload reliability (PRs #337-344, Nov 24, 2025)

**motivation**: exports were failing silently on large files (OOM), uploads showed incorrect progress, and SSE connections triggered false error toasts.

**what shipped**:
- **database-backed jobs** (PR #337): moved upload/export tracking from in-memory to postgres
  - jobs table persists state across server restarts
  - enables reliable progress tracking via SSE polling
- **streaming exports** (PR #343): fixed OOM on large file exports
  - previously loaded entire files into memory via `response["Body"].read()`
  - now streams to temp files, adds to zip from disk (constant memory)
  - 90-minute WAV files now export successfully on 1GB VM
- **progress tracking fix** (PR #340): upload progress was receiving bytes but treating as percentage
  - `UploadProgressTracker` now properly converts bytes to percentage
  - upload progress bar works correctly again
- **UX improvements** (PRs #338-339, #341-342, #344):
  - export filename now includes date (`plyr-tracks-2025-11-24.zip`)
  - toast notification on track deletion
  - fixed false "lost connection" error when SSE completes normally
  - progress now shows "downloading track X of Y" instead of confusing count

**impact**:
- exports work for arbitrarily large files (limited by disk, not RAM)
- upload progress displays correctly
- job state survives server restarts
- clearer progress messaging during exports

---

**what shipped**:
- **removed hardcoded namespaces** (PR #263):
  - replaced hardcoded `"fm.plyr.like"` strings in `src/backend/_internal/atproto/records.py`
  - added `like_collection` computed field to config (mirrors existing `track_collection`)
  - fixed OAuth scope generation to use computed fields instead of hardcoded strings
  - updated `scripts/backfill_atproto_records.py` to use settings (was using hardcoded namespace)
- **environment-specific namespaces**:
  - development: `fm.plyr.dev` (local .env)
  - staging: `fm.plyr.stg` (flyctl secrets)
  - production: `fm.plyr` (flyctl secrets)
- **data migration**:
  - migrated 7 tracks + 5 likes from `fm.plyr.*` to `fm.plyr.dev.*` in development
  - migrated 7 tracks + 5 likes from `fm.plyr.*` to `fm.plyr.stg.*` in staging
  - used combination of automated script + manual cleanup with neon MCP and pdsx
  - cleaned up old staging records from production namespace
- **documentation** (PR #264):
  - updated `docs/deployment/environments.md` with namespace configuration
  - updated `docs/backend/configuration.md` with environment-specific examples
  - removed typer from project dependencies (moved to PEP 723 inline script deps)
  - created `sandbox/stg-namespace-migration/README.md` documenting migration process

**impact**:
- ✅ test tracks/likes no longer pollute production collections
- ✅ OAuth scopes environment-specific and automatically generated from config
- ✅ database and ATProto records stay aligned within each environment
- ✅ proper data separation for dev/staging/production environments
- ✅ eliminated hardcoded namespace strings throughout codebase

**lessons learned**:
- PEP 723 inline script dependencies work well for ad-hoc migration scripts
- database as source of truth more reliable than PDS for stale record lookups
- manual cleanup sometimes faster than debugging complex migration logic

**follow-up cleanup** (Nov 18, 2025):
- discovered 82 orphaned test/dev records remaining in production `fm.plyr.track` namespace
- created analysis script (`scripts/identify_orphaned_records.py`) to cross-reference PDS records against production database
- verified all 13 production tracks safe (including critical tracks: webhook with features, dinah, lil blues improv)
- automated deletion via generated script with proper PDS authentication
- result: 95 → 13 records in production namespace, all production data intact
- filed upstream issue ([pdsx#43](https://github.com/zzstoatzz/pdsx/issues/43)) for batch/concurrent CRUD operations

### mobile UI polish (PRs #259-261, #265, #268, Nov 17, 2025)

**serialization improvements** (PRs #259-260):
- created `TrackResponse` Pydantic model for consistent track serialization
- fixed album endpoint to properly serialize tracks (was mixing dict/model types)
- eliminated manual dict construction in favor of model-based serialization
- better type safety and consistency across endpoints

**notifications fix** (PR #261):
- notification bot was using hardcoded `https://plyr.fm` URL
- now uses environment-aware `settings.frontend.url` (staging uses `https://stg.plyr.fm`)
- ensures notifications link to correct environment

**sticky player padding** (PRs #265, #268):
- fixed album tracks overlapping with sticky bottom player on mobile (#265)
- attempted centralized padding approach (#266) but created excessive whitespace on mobile
- reverted to per-page padding handling (#268) while keeping album track clearance fix
- mobile padding now matches pre-centralization behavior

**impact**:
- ✅ consistent track serialization across all endpoints
- ✅ notifications link to correct environment
- ✅ album tracks properly clear sticky player on mobile
- ✅ mobile padding back to appropriate levels (no excessive whitespace)

---

_for detailed history before Nov 17, 2025, see [.status_history/2025-11.md](.status_history/2025-11.md)_
