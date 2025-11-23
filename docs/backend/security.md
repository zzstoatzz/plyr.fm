# Security

Overview of security mechanisms in plyr.fm.

## Authentication

We use **HttpOnly Cookies** for session management to prevent XSS attacks.
See [ATProto Identity & Auth](atproto-identity.md) for details on the OAuth flow and token management.

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

## CORS

Cross-Origin Resource Sharing (CORS) is configured to allow:
*   **Localhost:** For development (`http://localhost:5173`).
*   **Production/Staging Domains:** `plyr.fm`, `stg.plyr.fm`, and Cloudflare Pages preview URLs (via regex).

Configuration is managed in `src/backend/config.py` under `FrontendSettings`.
