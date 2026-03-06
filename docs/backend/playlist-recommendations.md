---
title: "playlist recommendations"
---

recommends tracks for a playlist based on its existing tracks' CLAP embeddings in turbopuffer. shown inline when editing a playlist.

## architecture

```
playlist track IDs
        │
        ▼
  get_vectors()              turbopuffer
  (fetch embeddings)    ──►  (vector ANN query per signal)
        │                          │
        ▼                          ▼
  adaptive strategy          ranked result lists
  (direct / RRF / k-means)        │
        │                          ▼
        ▼                    rrf_merge()
  query vectors                    │
                                   ▼
                             hydrate from postgres
                             (Track + Artist join)
```

## adaptive strategy

the algorithm scales with playlist size:

| playlist size | strategy | queries |
|---------------|----------|---------|
| 1 track | direct query with track's embedding | 1 |
| 2-5 tracks | query each track's embedding, merge via RRF | N |
| 6+ tracks | k-means cluster into min(3, N//2) centroids, query each, merge via RRF | min(3, N//2) |

### reciprocal rank fusion (RRF)

when multiple query vectors produce separate ranked lists, RRF merges them into a single ranking. tracks appearing in multiple lists rank higher. the formula for each track:

```
score = sum(1 / (k + rank_in_list)) for each list containing the track
```

where `k=60` (standard RRF constant). excludes tracks already in the playlist. keeps the best (lowest) distance when a track appears in multiple lists.

### k-means clustering

for larger playlists (6+), querying every track is expensive. instead, we cluster the track embeddings into centroids that represent the playlist's "sound regions" and query those.

implementation is pure python (no numpy/sklearn) — the vectors are 512-dim floats and playlists are small (typically <100 tracks), so a simple iterative k-means converges quickly.

## caching

recommendations are cached in Redis with a key derived from the playlist's ATProto record CID:

```
plyr:recommendations:{playlist_id}:{atproto_record_cid}
```

the CID changes whenever tracks are added, removed, or reordered, so cached recommendations auto-invalidate on playlist changes. TTL is 24 hours for natural refresh as the catalog grows.

if Redis is unavailable, recommendations compute fresh on each request (graceful degradation).

## API

### `GET /playlists/{playlist_id}/recommendations?limit=3`

requires auth (playlist owner only). returns recommended tracks to add.

**query params**: `limit` (default 3, max 10)

**response**:
```json
{
  "tracks": [
    {
      "id": 123,
      "title": "Ambient Waves",
      "artist_handle": "artist.bsky.social",
      "artist_display_name": "Artist Name",
      "image_url": "https://..."
    }
  ],
  "available": true
}
```

`available: false` when turbopuffer is disabled, the playlist is empty, or no tracks have embeddings. the frontend hides the section entirely in this case.

## frontend

recommendations appear below the "add tracks" button when editing a playlist. they are visually identical to TrackItem cards but distinguished by:
- dashed border (vs solid for playlist tracks)
- reduced opacity (0.7, full on hover)
- "+" button instead of track actions

adding a recommended track moves it into the playlist and triggers a re-fetch (since the playlist context changed). recommendations clear when exiting edit mode.

## graceful degradation

no feature flag required. the feature degrades gracefully:
- turbopuffer disabled → `available: false`, frontend hides section
- no tracks have embeddings → `available: false`
- Redis unavailable → computes fresh, no caching
- empty playlist → returns empty immediately

## key files

- `backend/src/backend/_internal/recommendations.py` — recommendation logic, RRF merge, k-means
- `backend/src/backend/_internal/clients/tpuf.py` — `get_vectors()` for fetching track embeddings
- `backend/src/backend/api/lists.py` — `/playlists/{id}/recommendations` endpoint + Redis cache
- `frontend/src/routes/playlist/[id]/+page.svelte` — recommendation UI in edit mode
- `backend/tests/test_recommendations.py` — unit tests for RRF, k-means, adaptive strategy
