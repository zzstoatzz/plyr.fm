# feat: unified search across tracks, artists, albums, and tags

## summary

implement a unified search endpoint that allows users to search across all content types: tracks, artists, albums, and tags. currently we only have ATProto handle search via Bluesky API (`/search/handles`).

## motivation

as the catalog grows, users need a way to quickly find content. searching for a song title, artist name, or tag should all work from a single search box.

## research: search technology options

| option | cost | complexity | scale | fit for plyr.fm |
|--------|------|------------|-------|-----------------|
| **PostgreSQL FTS + pg_trgm** | $0 | low | small-medium | ✅ excellent (MVP) |
| **pg_search (ParadeDB)** | $0 | medium | medium-large | great (phase 2) |
| **Meilisearch** | $0-30/mo | medium | any | good (phase 3) |
| **Typesense** | $0+ | medium | any | good (phase 3) |
| **Turbopuffer** | $64/mo min | medium | large | overkill now |
| **ElasticSearch** | $$$ | high | enterprise | overkill |

### option details

**1. PostgreSQL native FTS + pg_trgm** (recommended for MVP)
- [neon supports pg_trgm](https://neon.com/docs/extensions/pg_trgm) - 8k+ databases use it
- zero cost increase, no new services to manage
- GIN indexes provide ~3x faster lookups vs GiST
- `pg_trgm` enables fuzzy matching (typo tolerance, similarity search)
- performance: excellent for <100k rows per entity
- [good for small-medium apps](https://iniakunhuda.medium.com/postgresql-full-text-search-a-powerful-alternative-to-elasticsearch-for-small-to-medium-d9524e001fe0)

**2. pg_search (ParadeDB on Neon)**
- [new partnership in 2025](https://neon.com/docs/extensions/pg_search) - up to 1000x faster than native FTS
- BM25 ranking (elasticsearch-grade relevance)
- typo tolerance, faceted search, JSON-aware filtering
- still native to postgres - no sync complexity
- good upgrade path when FTS becomes limiting

**3. Meilisearch / Typesense**
- [both free self-hosted](https://www.meilisearch.com/blog/meilisearch-vs-typesense), MIT/GPL licensed
- sub-50ms responses, typo tolerance built-in
- would require: separate fly.io app + sync mechanism
- adds operational complexity

**4. Turbopuffer**
- [serverless, 10x cheaper at scale](https://turbopuffer.com/pricing)
- supports both vector AND BM25 search
- used by Cursor, Notion
- **but:** $64/month minimum spend - overkill for current scale (~55 tracks)
- better fit when semantic/vector search is needed

## recommended approach

### phase 1: PostgreSQL native FTS + pg_trgm (implement now)

**database migration:**
```sql
-- enable extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- add tsvector columns for full-text search
ALTER TABLE tracks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(extra->>'album', '')), 'B')
  ) STORED;

ALTER TABLE artists ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(handle, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(bio, '')), 'B')
  ) STORED;

ALTER TABLE albums ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

-- GIN indexes for full-text search
CREATE INDEX idx_tracks_search ON tracks USING GIN(search_vector);
CREATE INDEX idx_artists_search ON artists USING GIN(search_vector);
CREATE INDEX idx_albums_search ON albums USING GIN(search_vector);

-- trigram indexes for fuzzy/similarity matching
CREATE INDEX idx_tracks_title_trgm ON tracks USING GIN(title gin_trgm_ops);
CREATE INDEX idx_artists_handle_trgm ON artists USING GIN(handle gin_trgm_ops);
CREATE INDEX idx_artists_display_name_trgm ON artists USING GIN(display_name gin_trgm_ops);
CREATE INDEX idx_albums_title_trgm ON albums USING GIN(title gin_trgm_ops);
CREATE INDEX idx_tags_name_trgm ON tags USING GIN(name gin_trgm_ops);
```

**API design:**
```
GET /search?q=<query>&type=all|tracks|artists|albums|tags&limit=20
```

**response format:**
```json
{
  "results": [
    {"type": "track", "id": 1, "title": "summer vibes", "artist_handle": "dj.bsky.social", "relevance": 0.95},
    {"type": "artist", "did": "did:plc:...", "handle": "dj.bsky.social", "display_name": "DJ Cool", "relevance": 0.88},
    {"type": "album", "id": "uuid", "title": "summer collection", "artist_handle": "dj.bsky.social", "relevance": 0.82},
    {"type": "tag", "id": 1, "name": "summer", "track_count": 5, "relevance": 0.75}
  ],
  "counts": {"tracks": 5, "artists": 2, "albums": 1, "tags": 1}
}
```

### phase 2: pg_search (when needed)
- upgrade when we hit FTS limits or need better ranking
- no architecture change - swap index type
- enables BM25 ranking, better typo tolerance

### phase 3: external search (at scale)
- evaluate Meilisearch or Turbopuffer when:
  - 10k+ tracks
  - need faceted search (filter by tag + artist + date range)
  - need semantic/vector search (find similar tracks)

## implementation scope

1. **migration:** enable pg_trgm, add tsvector columns (generated), create GIN indexes
2. **backend:** new `/search` endpoint with unified query across entities
3. **frontend:** search input component, results dropdown/page
4. **nice-to-haves:** debounced typeahead, search history

## open questions

- [ ] should results be weighted by entity type? (e.g., tracks > artists > albums)
- [ ] include search in header (global) or on a dedicated search page?
- [ ] autocomplete/typeahead as-you-type?
- [ ] persist recent searches?

## references

- [neon pg_trgm docs](https://neon.com/docs/extensions/pg_trgm)
- [neon pg_search docs](https://neon.com/docs/extensions/pg_search)
- [postgresql FTS vs elasticsearch](https://iniakunhuda.medium.com/postgresql-full-text-search-a-powerful-alternative-to-elasticsearch-for-small-to-medium-d9524e001fe0)
- [meilisearch vs typesense](https://www.meilisearch.com/blog/meilisearch-vs-typesense)
- [turbopuffer pricing](https://turbopuffer.com/pricing)
