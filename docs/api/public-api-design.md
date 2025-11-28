# public developer API design

RFC for plyr.fm public API (issue #56)

## overview

this document proposes the design for plyr.fm's public developer API, enabling third-party integrations, mobile apps, and automation tools.

## goals

1. **external integrations** - enable third-party apps to interact with plyr.fm
2. **future-proof vocabulary** - generic "items" model for multi-content support (tracks, voice memos, snippets)
3. **versioning without breakage** - clear contract with deprecation policies
4. **security** - API keys with scopes, rate limiting, audit trails

## non-goals (v1)

- real-time streaming APIs (WebSocket/SSE)
- bulk operations (upload multiple tracks)
- admin/moderation APIs
- analytics APIs beyond basic play counts

---

## resource model

### design principle: items, not tracks

the current internal model uses "tracks" everywhere. for the public API, we introduce a **generic item model** that supports multiple content types:

```
item
├── type: "track" | "voice_memo" | "snippet" (future)
├── id: string (uuid)
├── title: string
├── artist: artist reference
├── album: album reference (optional)
├── metadata: type-specific fields
└── engagement: plays, likes, comments
```

### why "items"?

1. **forward compatibility** - adding voice memos, samples, or snippets won't require new top-level resources
2. **consistent patterns** - all content types share common fields (title, artist, engagement)
3. **simpler SDK design** - one `client.items.list()` method works for all types
4. **ATProto alignment** - lexicons can evolve (`fm.plyr.item` → `fm.plyr.item.track`, `fm.plyr.item.memo`)

### v1 resource hierarchy

```
/v1
├── /items                    # all content items (filterable by type)
│   ├── GET /                 # list items
│   ├── GET /{id}            # get item by id
│   ├── POST /               # create item (upload)
│   ├── PATCH /{id}          # update item metadata
│   └── DELETE /{id}         # delete item
│
├── /artists                  # artist profiles
│   ├── GET /                 # list artists
│   ├── GET /{handle}        # get artist by handle
│   └── GET /{handle}/items  # get artist's items
│
├── /albums                   # album collections
│   ├── GET /                 # list albums
│   ├── GET /{id}            # get album by id
│   └── GET /{id}/items      # get album's items
│
├── /me                       # authenticated user context
│   ├── GET /                 # get current user
│   ├── GET /items           # get user's items
│   ├── GET /likes           # get user's liked items
│   ├── POST /likes/{id}     # like an item
│   └── DELETE /likes/{id}   # unlike an item
│
├── /upload                   # upload workflow
│   ├── POST /presigned      # get presigned upload URL
│   └── POST /complete       # finalize upload
│
└── /search                   # discovery
    └── GET /                 # search items, artists, albums
```

### response models

**item response** (all types):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "track",
  "title": "summer vibes",
  "artist": {
    "did": "did:plc:abc123",
    "handle": "artist.bsky.social",
    "display_name": "the artist",
    "avatar_url": "https://..."
  },
  "album": {
    "id": "...",
    "title": "debut ep",
    "slug": "debut-ep"
  },
  "media_url": "https://cdn.plyr.fm/audio/...",
  "image_url": "https://cdn.plyr.fm/images/...",
  "duration_ms": 180000,
  "play_count": 1234,
  "like_count": 56,
  "comment_count": 3,
  "created_at": "2025-01-15T10:30:00Z",
  "atproto": {
    "uri": "at://did:plc:abc123/fm.plyr.track/...",
    "cid": "bafyrei..."
  }
}
```

**collection response** (paginated):
```json
{
  "items": [...],
  "cursor": "eyJvZmZzZXQiOjUwfQ==",
  "has_more": true
}
```

---

## versioning strategy

### approach: URI-based versioning

```
https://api.plyr.fm/v1/items
https://api.plyr.fm/v2/items  (future)
```

**rationale**:
- most widely adopted pattern (Spotify, Stripe, GitHub, SoundCloud)
- explicit and cache-friendly (different URLs = different cache entries)
- easy to route at infrastructure level
- clear in documentation and debugging

### version lifecycle

| phase | duration | behavior |
|-------|----------|----------|
| **current** | indefinite | actively developed, full support |
| **deprecated** | 6+ months | still functional, deprecation headers, no new features |
| **sunset** | 30 days notice | returns 410 Gone with migration guidance |

### deprecation headers

deprecated endpoints include headers:
```http
Deprecation: Sun, 01 Jun 2025 00:00:00 GMT
Sunset: Sun, 01 Dec 2025 00:00:00 GMT
Link: <https://api.plyr.fm/v2/items>; rel="successor-version"
```

### breaking changes require new version

breaking changes that bump major version:
- removing fields from responses
- changing field types
- removing endpoints
- changing authentication requirements

non-breaking changes (same version):
- adding new optional fields
- adding new endpoints
- adding new query parameters with defaults
- relaxing validation constraints

### internal vs external versioning

```
external: v1, v2, v3 (major only, in URL)
internal: 1.2.3 (semver, in changelog, transparent to clients)
```

---

## authentication

### dual auth model

the API supports two authentication methods:

#### 1. session-based (browser clients)

existing HttpOnly cookie auth continues to work for browser-based applications:
```http
Cookie: session_id=...
```

#### 2. API keys (programmatic access)

new API key system for third-party applications:
```http
Authorization: Bearer plyr_sk_live_abc123...
```

### API key design

**key format** (Stripe-inspired):
```
plyr_{type}_{environment}_{random}

examples:
  plyr_sk_live_abc123def456...   # secret key, production
  plyr_sk_test_xyz789ghi012...   # secret key, sandbox
  plyr_pk_live_mno345pqr678...   # publishable key, production
```

**key types**:
| type | prefix | use case | capabilities |
|------|--------|----------|--------------|
| **secret** | `sk_` | server-to-server | full API access, never expose client-side |
| **publishable** | `pk_` | client-side (future) | read-only public data, embed widgets |

**environments**:
| env | prefix | behavior |
|-----|--------|----------|
| **live** | `_live_` | production data, real operations |
| **test** | `_test_` | sandbox mode, isolated test data |

### key management

**portal features**:
- create/revoke API keys
- view key usage statistics
- set expiration dates
- optional IP allowlists
- activity log (recent API calls)

**key storage**:
- only hash stored in database (bcrypt or argon2)
- full key shown once at creation time
- keys can be rotated (old key expires after grace period)

### scopes (future)

v1 launches with full-access keys. future versions may add granular scopes:
```
items:read      - list and read items
items:write     - create, update, delete items
likes:read      - read user's likes
likes:write     - like/unlike items
upload          - upload new content
```

---

## rate limiting

### tiered limits

| tier | requests/minute | requests/day | notes |
|------|-----------------|--------------|-------|
| **anonymous** | 30 | 1,000 | public endpoints only |
| **authenticated** | 100 | 10,000 | session or API key |
| **verified** | 300 | 50,000 | approved applications |

### per-endpoint limits

some endpoints have stricter limits:
| endpoint | limit | reason |
|----------|-------|--------|
| `POST /upload/*` | 10/hour | storage costs |
| `POST /*/like` | 60/minute | spam prevention |
| `GET /search` | 30/minute | query complexity |

### rate limit headers

all responses include:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1704067200
Retry-After: 45  # only on 429 responses
```

### implementation

extend existing slowapi setup with:
- key-based rate limiting (in addition to IP)
- per-endpoint decorators
- Redis backend (when scaling requires it)

---

## error handling

### error response format

```json
{
  "error": {
    "code": "item_not_found",
    "message": "the requested item does not exist",
    "status": 404,
    "details": {
      "item_id": "550e8400-e29b-41d4-a716-446655440000"
    },
    "docs_url": "https://docs.plyr.fm/errors/item_not_found"
  },
  "request_id": "req_abc123"
}
```

### error codes

| code | status | description |
|------|--------|-------------|
| `invalid_request` | 400 | malformed request body or parameters |
| `unauthorized` | 401 | missing or invalid authentication |
| `forbidden` | 403 | valid auth but insufficient permissions |
| `item_not_found` | 404 | resource does not exist |
| `conflict` | 409 | resource state conflict (e.g., already liked) |
| `rate_limited` | 429 | too many requests |
| `internal_error` | 500 | server error (retry with backoff) |

---

## pagination

### cursor-based pagination

```http
GET /v1/items?limit=25&cursor=eyJvZmZzZXQiOjI1fQ==
```

**response**:
```json
{
  "items": [...],
  "cursor": "eyJvZmZzZXQiOjUwfQ==",
  "has_more": true
}
```

**rationale**:
- handles insertions/deletions gracefully (unlike offset)
- efficient for large datasets
- used by SoundCloud, Bluesky, most modern APIs

### limits

| parameter | default | max |
|-----------|---------|-----|
| `limit` | 25 | 100 |

---

## upload workflow

### signed URL pattern

uploads use presigned URLs to avoid passing large files through the API server:

```
1. POST /v1/upload/presigned
   body: { filename: "track.mp3", content_type: "audio/mpeg", size: 15000000 }
   response: { upload_id: "...", presigned_url: "https://r2...", expires_at: "..." }

2. PUT {presigned_url}
   body: <raw file bytes>

3. POST /v1/upload/complete
   body: { upload_id: "...", title: "my track", album_id: "..." }
   response: { item: {...}, job_id: "..." }

4. GET /v1/jobs/{job_id}  # poll for processing status
   response: { status: "completed", item_id: "..." }
```

**benefits**:
- large files go directly to R2 (no API server memory pressure)
- resumable uploads possible
- progress tracking via job status

---

## webhook events (future)

for v2, consider webhook support:
```json
{
  "event": "item.played",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "item_id": "...",
    "listener_did": "did:plc:..."
  }
}
```

potential events:
- `item.created`, `item.deleted`
- `item.played`
- `item.liked`, `item.unliked`
- `item.commented`

---

## OpenAPI specification

the API will be documented with OpenAPI 3.1:
- auto-generated from FastAPI route definitions
- published at `https://api.plyr.fm/v1/openapi.json`
- interactive docs at `https://docs.plyr.fm/api`

---

## implementation phases

### phase 1: foundation
- [ ] API key model and database schema
- [ ] key generation endpoint in portal
- [ ] key-based authentication middleware
- [ ] versioned router (`/v1/` prefix)

### phase 2: core endpoints
- [ ] `GET /v1/items` (list with filters)
- [ ] `GET /v1/items/{id}`
- [ ] `GET /v1/artists/{handle}`
- [ ] `GET /v1/me`
- [ ] `GET /v1/me/likes`

### phase 3: mutations
- [ ] `POST /v1/upload/*` workflow
- [ ] `PATCH /v1/items/{id}`
- [ ] `DELETE /v1/items/{id}`
- [ ] `POST/DELETE /v1/me/likes/{id}`

### phase 4: polish
- [ ] OpenAPI spec generation
- [ ] developer documentation site
- [ ] SDK templates (Python, TypeScript)
- [ ] rate limiting refinements

---

## open questions

1. **test environment isolation** - should test keys operate on production data with read-only access, or require a separate sandbox database?

2. **ATProto integration** - should API keys be able to write ATProto records on behalf of users, or require full OAuth?

3. **rate limit tiers** - how should "verified" status be granted? manual approval? payment?

4. **internal migration** - should the portal/frontend migrate to use `/v1/` endpoints, or maintain separate internal routes?

---

## references

research sources:
- [API versioning best practices (2025)](https://www.devzery.com/post/versioning-rest-api-strategies-best-practices-2025)
- [Stripe API keys documentation](https://docs.stripe.com/keys)
- [Spotify Web API](https://developer.spotify.com/documentation/web-api)
- [SoundCloud API guide](https://developers.soundcloud.com/docs/api/guide)
- [Bluesky API](https://docs.bsky.app)

internal references:
- [authentication.md](../authentication.md) - existing auth system
- [rate-limiting.md](../rate-limiting.md) - existing rate limiting
- issue #56 - original feature request
- issue #57 - multi-content type support
