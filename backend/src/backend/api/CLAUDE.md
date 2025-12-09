# api

public HTTP endpoints.

auth:
- all endpoints except `/auth/*` require session cookie
- OAuth 2.1 flow via ATProto: `/auth/authorize`, `/auth/callback`, `/auth/logout`
- session management in `_internal/auth.py`

resources:
- **tracks**: upload, edit, delete, like/unlike, play count tracking, timed comments
- **albums**: CRUD with cover art, track ordering, ATProto list records
- **playlists**: CRUD with drag-and-drop reordering, ATProto list records
- **artists**: profiles synced from ATProto identities, support links
- **audio**: streaming via 307 redirects to R2 CDN
- **queue**: server-authoritative with optimistic client updates
- **preferences**: user settings (accent color, auto-play, teal scrobbling, sensitive artwork)
- **exports**: media export with SSE progress tracking, concurrent downloads
- **moderation**: sensitive image management, copyright label checking
- **stats**: platform statistics (track count, play count, total duration)