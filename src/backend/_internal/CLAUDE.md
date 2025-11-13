# _internal

internal services and business logic.

- **auth**: OAuth session encryption (Fernet), token refresh with per-session locks
- **atproto**: record creation (fm.plyr.track, fm.plyr.like), PDS resolution with caching
- **queue**: fisher-yates shuffle with retry, postgres LISTEN/NOTIFY for cache invalidation
- **uploads**: streaming chunked uploads to R2/filesystem, duplicate detection via file_id

gotchas:
- ATProto records use `_internal/atproto/records.py` (not `src/backend/atproto/`)
- file_id is sha256 hash truncated to 16 chars
- queue cache is TTL-based (5min), hydration includes duplicate track_ids