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
- file_id is sha256 hash truncated to 16 chars
- queue cache is TTL-based (5min), hydration includes duplicate track_ids
- background tasks use docket (Redis-backed) with asyncio fallback for local dev