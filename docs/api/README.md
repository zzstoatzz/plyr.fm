# API documentation

design docs for plyr.fm's public developer API (issue #56).

## documents

| document | description |
|----------|-------------|
| [public-api-design.md](./public-api-design.md) | RFC covering resource model, versioning, auth, rate limiting |
| [api-key-schema.md](./api-key-schema.md) | database schema and implementation for API key management |

## status

**phase**: design review

these docs represent the proposed design. implementation will begin after review.

## quick summary

### versioning
- URI-based: `/v1/tracks`, `/v2/tracks`
- deprecation headers with 6+ month warning

### authentication
- API keys: `plyr_sk_live_...` (Stripe-style prefixes)
- session cookies (existing browser auth)

### resource model
- `/tracks` for tracks (no premature abstraction)
- add `/voice-memos` etc when needed

### key endpoints
```
GET  /v1/tracks             list tracks
GET  /v1/tracks/{id}        get track
GET  /v1/artists/{handle}   get artist
GET  /v1/me                 current user
GET  /v1/me/likes           liked tracks
POST /v1/tracks             upload track
```

### OpenAPI
FastAPI auto-generates from route definitions:
- `/v1/openapi.json` - spec
- `/v1/docs` - interactive docs

## open questions

1. test environment isolation (sandbox vs read-only prod)
2. ATProto record creation via API keys
3. rate limit tier approval process
4. internal route migration strategy

see [public-api-design.md](./public-api-design.md) for details.
