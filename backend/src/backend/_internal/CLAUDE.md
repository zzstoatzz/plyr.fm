# _internal

internal services and business logic.

- **auth**: OAuth session encryption (Fernet), token refresh with per-session locks
- **atproto**: record creation organized by lexicon namespace
  - `client.py`: low-level PDS requests, token refresh with per-session locks
  - `records/fm_plyr/`: plyr.fm lexicons (track, like, comment, list, profile)
  - `records/fm_teal/`: teal.fm lexicons (play, status)
  - `sync.py`: high-level sync orchestration (profile, albums, liked list)
- **background**: docket-based background task system
  - `background.py`: docket client initialization and configuration
  - `background_tasks.py`: task functions (copyright scan, export, atproto sync, teal scrobble)
- **queue**: fisher-yates shuffle with retry, postgres LISTEN/NOTIFY for cache invalidation
- **uploads**: streaming chunked uploads to R2/filesystem, duplicate detection via file_id
- **moderation**: copyright scanning via AudD, sensitive image flagging
- **jobs**: job tracking for long-running operations (exports)

gotchas:
- ATProto records organized under `_internal/atproto/records/` by lexicon namespace
- file_id is sha256 hash truncated to 16 chars on the upload path; firehose-ingested tracks fall back to the record's rkey (`ingest_track_create`), so a `file_id` that isn't a 16-char hex hash means the track came from the firehose, not a plyr upload
- queue cache is TTL-based (5min), hydration includes duplicate track_ids
- background tasks use docket (Redis-backed) with asyncio fallback for local dev
- **OAuth scope coupling**: when adding a new lexicon integration (new `repo:` token),
  THREE places must update together or PAR fails with `invalid_scope` at login:
  1. `AtprotoSettings.resolved_scope_with_extras` in `backend/config.py` —
     the runtime composer that decides which scopes a flow asks for
  2. `get_oauth_client` / `get_oauth_client_for_scope` /
     `start_oauth_flow_with_scopes` in `_internal/auth/oauth.py` — the
     flags that turn the new scope on/off per flow
  3. `client_metadata()` in `api/meta.py` — the published universe that
     the authserver checks every PAR against
  the regression test `tests/api/test_oauth_client_metadata.py` asserts
  the published universe is a superset of every integration's tokens.