# unified search

global search across tracks, artists, albums, and tags with fuzzy matching.

## usage

**keyboard shortcut**: `Cmd+K` (mac) or `Ctrl+K` (windows/linux)

the search modal opens as an overlay with:
- instant fuzzy matching as you type
- results grouped by type with relevance scores
- keyboard navigation (arrow keys, enter, esc)
- artwork/avatars displayed when available

## architecture

### frontend

**state management**: `frontend/src/lib/search.svelte.ts`

```typescript
import { search } from '$lib/search.svelte';

// open/close
search.open();
search.close();
search.toggle();

// reactive state
search.isOpen      // boolean
search.query       // string
search.results     // SearchResult[]
search.loading     // boolean
search.error       // string | null
```

**component**: `frontend/src/lib/components/SearchModal.svelte`

renders the search overlay with:
- debounced input (150ms)
- keyboard navigation
- lazy-loaded images with fallback
- platform-aware shortcut hints

**keyboard handler**: `frontend/src/routes/+layout.svelte`

```typescript
// Cmd/Ctrl+K toggles search from anywhere
if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
  event.preventDefault();
  search.toggle();
}
```

### backend

**endpoint**: `GET /search/`

```
GET /search/?q=query&type=tracks,artists&limit=10
```

**parameters**:
- `q` (required): search query, 2-100 characters
- `type` (optional): filter by type(s), comma-separated: `tracks`, `artists`, `albums`, `tags`, `playlists`
- `limit` (optional): max results per type, 1-50, default 20

**response**:

```json
{
  "results": [
    {
      "type": "track",
      "id": 123,
      "title": "song name",
      "artist_handle": "artist.bsky.social",
      "artist_display_name": "artist name",
      "image_url": "https://...",
      "relevance": 0.85
    },
    {
      "type": "artist",
      "did": "did:plc:...",
      "handle": "artist.bsky.social",
      "display_name": "artist name",
      "avatar_url": "https://...",
      "relevance": 0.72
    }
  ],
  "counts": {
    "tracks": 5,
    "artists": 2,
    "albums": 1,
    "tags": 0
  }
}
```

**implementation**: `backend/src/backend/api/search.py`

### database

**extension**: `pg_trgm` for trigram-based fuzzy matching

**indexes** (GIN with `gin_trgm_ops`):
- `ix_tracks_title_trgm` on `tracks.title`
- `ix_artists_handle_trgm` on `artists.handle`
- `ix_artists_display_name_trgm` on `artists.display_name`
- `ix_albums_title_trgm` on `albums.title`
- `ix_tags_name_trgm` on `tags.name`

**migration**: `backend/alembic/versions/2025_12_03_..._add_pg_trgm_extension_and_search_indexes.py`

## fuzzy matching

uses postgresql's `similarity()` function from `pg_trgm`:

```sql
SELECT title, similarity(title, 'query') as relevance
FROM tracks
WHERE similarity(title, 'query') > 0.1
ORDER BY relevance DESC
```

**threshold**: 0.1 minimum similarity (configurable)

**scoring**: 0.0 to 1.0, where 1.0 is exact match

**examples**:
- "bufo" matches "bufo" (1.0), "bufo mix" (0.6), "buffalo" (0.4)
- "zz" matches "zzstoatzz" (0.3), "jazz" (0.25)

## semantic search (mood search)

in addition to keyword search, plyr.fm supports semantic search via CLAP audio embeddings. users describe a mood or vibe in natural language and get tracks ranked by audio similarity.

**gated by feature flag**: `vibe-search` (per-user)

### how it works

1. user types a text description (e.g., "chill lo-fi beats")
2. frontend sends query to `GET /search/semantic?q=...`
3. backend embeds the text via CLAP model (Modal)
4. text embedding is compared against pre-computed audio embeddings in turbopuffer
5. matching tracks returned with similarity scores

### frontend behavior

- **debounce**: 500ms (vs 150ms for keyword search)
- **minimum query length**: 3 characters (vs 2 for keyword)
- **max results**: 5 per query
- results are deduplicated against keyword results
- similarity scores are merged alongside relevance scores

### backend endpoint

```
GET /search/semantic?q=chill+vibes&limit=10
```

**parameters**:
- `q` (required): text description, 3-200 characters
- `limit` (optional): max results, 1-50, default 10 (capped at 5 internally)

**response**:

```json
{
  "results": [
    {
      "type": "track",
      "id": 456,
      "title": "midnight drift",
      "artist_handle": "artist.bsky.social",
      "artist_display_name": "artist name",
      "image_url": "https://...",
      "similarity": 0.7234
    }
  ],
  "query": "chill vibes",
  "available": true
}
```

`available: false` indicates the embedding service is down - the frontend falls back to keyword-only search.

see [mood-search.md](../backend/mood-search.md) for full backend architecture.

## result types

### tracks

- links to `/track/{id}`
- shows artwork if available
- subtitle: "by {artist_display_name}"

### artists

- links to `/u/{handle}`
- shows avatar if available
- subtitle: "@{handle}"

### albums

- links to `/u/{artist_handle}/album/{slug}`
- shows cover art if available
- subtitle: "by {artist_display_name}"

### playlists

- links to `/u/{artist_handle}/playlist/{slug}`
- shows cover art if available
- subtitle: "by {artist_display_name}"

### tags

- links to `/tag/{name}`
- no artwork
- subtitle: "{count} tracks"

## error handling

**client-side validation**:
- minimum 2 characters to search
- maximum 100 characters (shows inline error)

**api errors**:
- 422: query validation failed
- displayed as error message in modal

**image loading**:
- lazy loading via `loading="lazy"`
- on error: hides image, shows fallback icon

## scaling

pg_trgm with GIN indexes scales well:
- handles millions of rows efficiently
- index size grows ~3x text size
- queries remain sub-millisecond for typical workloads

current production scale (~100 entities) is trivial.

## future enhancements

- search trigger button in header (for discoverability)
- recent searches history
- search within specific entity type tabs
- full-text search with `tsvector` for longer content
- search suggestions/autocomplete
