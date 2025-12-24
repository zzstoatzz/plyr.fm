# Security

Overview of security mechanisms in plyr.fm.

## Authentication

We use **HttpOnly Cookies** for session management to prevent XSS attacks.
See [Authentication](authentication.md) for details on the OAuth flow, token management, and environment architecture.

For backend implementation details regarding ATProto identity resolution, see [backend/atproto-identity.md](backend/atproto-identity.md).

## Rate Limiting

We enforce application-side rate limits to prevent abuse.
See [Rate Limiting](rate-limiting.md) for configuration and architecture details.

## HTTP Security Headers

The `SecurityHeadersMiddleware` in `src/backend/main.py` automatically applies industry-standard security headers to all responses:

*   **`Strict-Transport-Security` (HSTS):** Enforces HTTPS (Production only). Max-age set to 1 year.
*   **`X-Content-Type-Options: nosniff`:** Prevents browsers from MIME-sniffing a response away from the declared content-type.
*   **`X-Frame-Options: DENY`:** Prevents the site from being embedded in iframes (clickjacking protection).
*   **`X-XSS-Protection: 1; mode=block`:** Enables browser cross-site scripting filters.
*   **`Referrer-Policy: strict-origin-when-cross-origin`:** Controls how much referrer information is included with requests.

## Supporter-Gated Content

Tracks with `support_gate` set require atprotofans supporter validation before streaming.

### Access Model

```
request → /audio/{file_id} → check support_gate
                                    ↓
                         ┌──────────┴──────────┐
                         ↓                     ↓
                      public              gated track
                         ↓                     ↓
                   307 → R2 CDN         validate_supporter()
                                               ↓
                                    ┌──────────┴──────────┐
                                    ↓                     ↓
                              is supporter           not supporter
                                    ↓                     ↓
                           presigned URL (5min)        402 error
```

### Storage Architecture

- **public bucket**: `plyr-audio` - CDN-backed, public read access
- **private bucket**: `plyr-audio-private` - no public access, presigned URLs only

when `support_gate` is toggled, a background task moves the file between buckets.

### Presigned URL Behavior

presigned URLs are time-limited (5 minutes) and grant direct R2 access. security considerations:

1. **URL sharing**: a supporter could share the presigned URL. mitigation: short TTL, URLs expire quickly.

2. **offline caching**: if a supporter downloads content (via "download liked tracks"), the cached audio persists locally even if support lapses. this is **intentional** - they legitimately accessed it when authorized.

3. **auto-download + gated tracks**: the `gated` field is viewer-resolved (true = no access, false = has access). when liking a track with auto-download enabled:
   - **supporters** (`gated === false`): download proceeds normally via presigned URL
   - **non-supporters** (`gated === true`): download is skipped client-side to avoid wasted 402 requests

### ATProto Record Behavior

when a track is gated, the ATProto `fm.plyr.track` record's `audioUrl` changes:
- **public**: points to R2 CDN URL (e.g., `https://cdn.plyr.fm/audio/abc123.mp3`)
- **gated**: points to API endpoint (e.g., `https://api.plyr.fm/audio/abc123`)

this means ATProto clients cannot stream gated content without authentication through plyr.fm's API.

### Validation Caching

currently, `validate_supporter()` makes a fresh call to atprotofans on every request. for high-traffic gated tracks, consider adding a short TTL cache (e.g., 60s in redis) to reduce latency and avoid rate limits.

## CORS

Cross-Origin Resource Sharing (CORS) is configured to allow:
*   **Localhost:** For development (`http://localhost:5173`).
*   **Production/Staging Domains:** `plyr.fm`, `stg.plyr.fm`, and Cloudflare Pages preview URLs (via regex).

Configuration is managed in `src/backend/config.py` under `FrontendSettings`.