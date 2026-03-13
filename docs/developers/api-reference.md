---
title: "API reference"
description: "plyr.fm REST API endpoints, request/response examples, and error codes"
---

base URL: `https://api.plyr.fm`

full OpenAPI spec: [api.plyr.fm/docs](https://api.plyr.fm/docs)

authentication: `Authorization: Bearer <developer_token>` header or `session_id` HttpOnly cookie. see the [auth guide](/developers/auth/) for details.

## tracks

### search tracks

```
GET /search/?q={query}&type=tracks&limit=10
```

```json
{
  "results": [
    {
      "id": 42,
      "title": "midnight rain",
      "artist": { "did": "did:plc:abc", "handle": "artist.bsky.social", "display_name": "artist" },
      "duration": 180,
      "play_count": 1234,
      "like_count": 56,
      "image_url": "https://pub-....r2.dev/images/abc123.webp",
      "thumbnail_url": "https://pub-....r2.dev/images/abc123_thumb.webp"
    }
  ],
  "count": 1
}
```

the `type` parameter accepts: `tracks`, `artists`, `albums`, `tags`, `playlists`. omit it to search all types.

### mood search

```
GET /search/vibe?q=rainy+afternoon+jazz&limit=5
```

semantic search via CLAP audio embeddings. describe a mood or vibe instead of a keyword.

### get a track

```
GET /tracks/{track_id}
```

```json
{
  "id": 42,
  "title": "midnight rain",
  "description": "late night ambient",
  "artist": {
    "did": "did:plc:abc",
    "handle": "artist.bsky.social",
    "display_name": "artist",
    "avatar_url": "https://..."
  },
  "album": { "id": "uuid", "title": "nocturne", "slug": "nocturne" },
  "image_url": "https://...",
  "thumbnail_url": "https://...",
  "file_type": "mp3",
  "duration": 180,
  "play_count": 1234,
  "like_count": 56,
  "comment_count": 12,
  "is_liked": false,
  "is_public": true,
  "tags": ["ambient", "electronic"],
  "created_at": "2026-01-15T10:30:00Z",
  "atproto_record_uri": "at://did:plc:abc/fm.plyr.track/3abc123"
}
```

### list tracks

```
GET /tracks/?limit=20&cursor={iso_timestamp}
```

optional query params: `artist_did`, `filter_hidden_tags` (boolean).

returns `{ tracks, next_cursor, has_more }`.

### stream audio

```
GET /tracks/{track_id}/stream
```

returns a `307` redirect to the CDN URL. follow the redirect to get the audio file. for supporter-gated tracks, authentication is required — returns `402` if the listener doesn't support the artist.

### record a play

```
POST /tracks/{track_id}/play
```

body (optional): `{ "ref": "share_code" }` for listen receipt tracking.

### top tracks

```
GET /tracks/top?limit=10
```

returns tracks sorted by play count.

## likes

### like a track

```
POST /tracks/{track_id}/like
```

**auth required.** creates an `fm.plyr.like` record in your PDS.

### unlike a track

```
DELETE /tracks/{track_id}/like
```

**auth required.**

### get track likers

```
GET /tracks/{track_id}/likes
```

```json
{
  "users": [
    { "did": "did:plc:xyz", "handle": "user.bsky.social", "display_name": "user", "avatar_url": "https://...", "liked_at": "2026-01-15T10:30:00Z" }
  ],
  "count": 56
}
```

## comments

### get track comments

```
GET /tracks/{track_id}/comments
```

```json
{
  "comments": [
    {
      "id": 1,
      "text": "this part is incredible",
      "timestamp_ms": 45000,
      "author": { "did": "did:plc:xyz", "handle": "user.bsky.social" },
      "created_at": "2026-01-15T10:30:00Z"
    }
  ],
  "count": 12,
  "comments_enabled": true
}
```

### post a timed comment

```
POST /tracks/{track_id}/comments
```

**auth required.** body: `{ "text": "this part is incredible", "timestamp_ms": 45000 }`

text must be 1-300 characters. `timestamp_ms` is the playback position in milliseconds.

## albums

### list albums

```
GET /albums/?artist_did={did}&limit=20
```

### get album detail

```
GET /albums/{handle}/{slug}
```

returns `{ metadata, tracks }` with full track listing.

## playlists

### list playlists

```
GET /lists/?owner_did={did}&limit=20
```

### get playlist

```
GET /lists/{id}
```

returns the playlist with its full track listing.

## artists

### get artist profile

```
GET /artists/{did}
```

### get artist analytics

```
GET /artists/{did}/analytics
```

**auth required** (must be the artist). returns `{ total_plays, total_items, total_duration_seconds, top_item, top_liked }`.

## feeds (RSS)

```
GET /feeds/artist/{handle}
GET /feeds/album/{handle}/{slug}
GET /feeds/playlist/{playlist_id}
```

standard RSS feeds for artist tracks, albums, and playlists. compatible with any podcast client or feed reader.

## oEmbed

```
GET /oembed?url=https://plyr.fm/track/42
```

returns oEmbed JSON for automatic embed rendering. supports `maxwidth`, `maxheight`, and `format` params.

## platform

### stats

```
GET /stats
```

```json
{
  "total_plays": 12345,
  "total_tracks": 678,
  "total_artists": 90,
  "total_duration_seconds": 456789
}
```

### health check

```
GET /health
```

### config

```
GET /config
```

returns platform configuration: upload limits, default hidden tags, contact emails.

## tags

### list all tags

```
GET /tracks/tags
```

returns all tags with track counts.

## error responses

all errors return JSON with a `detail` field:

```json
{ "detail": "not authenticated - login required" }
```

| status | meaning |
|--------|---------|
| 400 | bad request — invalid parameters or validation failure |
| 401 | unauthorized — missing or invalid session/token |
| 402 | payment required — track is supporter-gated |
| 403 | forbidden — insufficient scope or not the owner |
| 404 | not found |
| 409 | conflict — queue revision mismatch (optimistic locking) |
| 429 | rate limit exceeded |

validation errors include structured detail:

```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "text"],
      "msg": "String should have at least 1 character"
    }
  ]
}
```

## pagination

list endpoints use cursor-based pagination. pass the `next_cursor` value from the response as the `cursor` query parameter to get the next page. cursors are ISO timestamps.

```
GET /tracks/?limit=20
→ { tracks: [...], next_cursor: "2026-01-15T10:30:00Z", has_more: true }

GET /tracks/?limit=20&cursor=2026-01-15T10:30:00Z
→ { tracks: [...], next_cursor: "2026-01-14T08:15:00Z", has_more: false }
```

## rate limiting

auth endpoints are limited to ~10 requests/minute. other endpoints have higher limits. responses include standard `RateLimit-*` headers. exceeding the limit returns `429`.
