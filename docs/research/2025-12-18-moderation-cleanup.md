# research: moderation cleanup

**date**: 2025-12-18
**question**: understand issues #541-544 and how the moderation system works to inform cleanup

## summary

the moderation system is split between backend (Python/FastAPI) and moderation service (Rust). copyright scanning uses AudD API, stores results in backend's `copyright_scans` table, and emits ATProto labels via the moderation service. there's a "lazy reconciliation" pattern on read paths that adds complexity. sensitive images are entirely in backend. the 4 issues propose consolidating this into a cleaner architecture.

## findings

### current architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND (Python)                        │
├─────────────────────────────────────────────────────────────────┤
│  _internal/moderation.py                                        │
│  - scan_track_for_copyright() → calls moderation service /scan  │
│  - _emit_copyright_label() → POST /emit-label                   │
│  - get_active_copyright_labels() → POST /admin/active-labels    │
│  (each creates its own httpx.AsyncClient)                       │
├─────────────────────────────────────────────────────────────────┤
│  models/copyright_scan.py                                       │
│  - is_flagged, resolution, matches, raw_response                │
│  - resolution field tries to mirror labeler state               │
├─────────────────────────────────────────────────────────────────┤
│  models/sensitive_image.py                                      │
│  - image_id or url, reason, flagged_at, flagged_by              │
├─────────────────────────────────────────────────────────────────┤
│  utilities/aggregations.py:73-175                               │
│  - get_copyright_info() does lazy reconciliation                │
│  - read path calls labeler, then WRITES to DB if resolved       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MODERATION SERVICE (Rust)                    │
├─────────────────────────────────────────────────────────────────┤
│  /scan - calls AudD API, returns scan result                    │
│  /emit-label - creates ATProto label in labeler DB              │
│  /admin/active-labels - returns URIs with non-negated labels    │
│  /admin/* - htmx admin UI for reviewing flags                   │
├─────────────────────────────────────────────────────────────────┤
│  labels table - ATProto labels with negation support            │
│  label_context table - track metadata for admin UI display      │
└─────────────────────────────────────────────────────────────────┘
```

### issue #541: ModerationClient class

**problem**: 3 functions in `moderation.py` each create their own `httpx.AsyncClient`:
- `_call_moderation_service()` (line 72-81)
- `_emit_copyright_label()` (line 179-185)
- `get_active_copyright_labels()` (line 259-268)

**solution**: extract `ModerationClient` class with shared client, auth, timeout handling. could use singleton pattern like `get_docket()` or store on `app.state`.

### issue #542: lazy resolution sync

**problem**: `get_copyright_info()` in `aggregations.py:73-175` does:
1. fetch scans from backend DB
2. for flagged tracks without resolution, call labeler
3. if label was negated, UPDATE the backend DB inline

this means read paths do writes, adding latency and complexity.

**solution**: move to docket background task that periodically syncs resolutions. read path becomes pure read.

### issue #543: dual storage source of truth

**problem**: copyright flag status stored in TWO places:
1. backend `copyright_scans.resolution` field
2. moderation service labeler (negation labels)

they can get out of sync, requiring reconciliation logic.

**options proposed**:
- A: labeler is source of truth (remove `resolution` from backend)
- B: backend is source of truth (labeler just signs labels)
- C: webhook sync (labeler notifies backend on changes)

### issue #544: SensitiveImage in wrong place

**problem**: `SensitiveImage` model and `/moderation/sensitive-images` endpoint are in backend, but all other moderation (copyright) is in moderation service.

**solution**: move to moderation service for consistency. frontend just changes the URL it fetches from.

## code references

- `backend/src/backend/_internal/moderation.py:59-81` - `_call_moderation_service()` with inline httpx client
- `backend/src/backend/_internal/moderation.py:134-196` - `_emit_copyright_label()` with inline httpx client
- `backend/src/backend/_internal/moderation.py:199-299` - `get_active_copyright_labels()` with redis caching
- `backend/src/backend/utilities/aggregations.py:73-175` - `get_copyright_info()` with lazy reconciliation
- `backend/src/backend/models/copyright_scan.py:23-76` - `CopyrightScan` model with `resolution` field
- `backend/src/backend/models/sensitive_image.py:11-38` - `SensitiveImage` model
- `backend/src/backend/api/moderation.py:24-39` - `/moderation/sensitive-images` endpoint

## dependencies between issues

```
#541 (ModerationClient)
  ↓
#542 (background sync) - uses ModerationClient
  ↓
#543 (source of truth) - depends on sync strategy

#544 (SensitiveImage) - independent, can be done anytime
```

## recommended order

1. **#541 first** - extract ModerationClient, improves testability, no behavior change
2. **#542 next** - move lazy sync to background task using new client
3. **#543 then** - once sync is background, decide source of truth (likely option A: labeler owns resolution)
4. **#544 anytime** - independent refactor, lower priority

## open questions

- should moderation service expose webhook for label changes? (would eliminate need for polling in #542)
- is the 5-minute redis cache TTL for labels appropriate? (currently in settings)
- does the admin UI need to stay in moderation service or could it move to main frontend `/admin` routes?
