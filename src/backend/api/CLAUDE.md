# api

public HTTP endpoints.

auth:
- all endpoints except `/auth/*` require session cookie
- OAuth 2.1 flow via ATProto: `/auth/authorize`, `/auth/callback`, `/auth/logout`
- session management in `_internal/auth.py`

resources:
- **tracks**: upload, edit, delete, like/unlike, play count tracking
- **artists**: profiles synced from ATProto identities
- **audio**: streaming via 307 redirects to R2 CDN
- **queue**: server-authoritative with optimistic client updates
- **preferences**: user settings (accent color, auto-play)