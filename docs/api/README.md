# API documentation

design docs for plyr.fm's public developer API (issue #56).

## documents

| document | description |
|----------|-------------|
| [public-api-design.md](./public-api-design.md) | RFC covering resource model, versioning, auth, rate limiting |
| [api-key-schema.md](./api-key-schema.md) | database schema and implementation for API key management |
| [openapi-v1-draft.yaml](./openapi-v1-draft.yaml) | draft OpenAPI 3.1 spec for v1 endpoints |

## status

**phase**: design review

these docs represent the proposed design. implementation will begin after review.

## quick summary

### versioning
- URI-based: `/v1/items`, `/v2/items`
- deprecation headers with 6+ month warning

### authentication
- API keys: `plyr_sk_live_...` (Stripe-style prefixes)
- session cookies (existing browser auth)

### resource model
- generic "items" for future multi-content support
- tracks, voice memos, snippets share common patterns

### key endpoints
```
GET  /v1/items              list items
GET  /v1/items/{id}         get item
GET  /v1/artists/{handle}   get artist
GET  /v1/me                 current user
GET  /v1/me/likes           liked items
POST /v1/upload/presigned   get upload URL
```

## open questions

1. test environment isolation (sandbox vs read-only prod)
2. ATProto record creation via API keys
3. rate limit tier approval process
4. internal route migration strategy

see [public-api-design.md](./public-api-design.md) for details.
