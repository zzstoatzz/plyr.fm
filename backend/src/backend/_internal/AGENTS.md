# internal services

## integration constraints
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