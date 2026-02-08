# mood search

semantic search over tracks using CLAP (Contrastive Language-Audio Pretraining) embeddings. users describe a mood in natural language and get matching tracks ranked by audio similarity.

## architecture

```
user types "dark ambient techno"
        │
        ▼
  Modal CLAP service          turbopuffer
  (embed_text)          ──►   (vector ANN query)
        │                           │
        ▼                           ▼
  512-dim text embedding      top-k similar tracks
                                    │
                                    ▼
                              hydrate from postgres
                              (Track + Artist join)
```

### how search works

keyword and semantic search fire in parallel from the frontend:

1. **keyword** (150ms debounce, min 2 chars) — standard pg_trgm fuzzy match against track titles, artist names, albums, tags, playlists
2. **semantic** (500ms debounce, min 3 chars, feature-flagged) — CLAP text embedding → turbopuffer ANN query → hydrate from postgres

keyword results appear instantly. semantic results append when ready. client-side deduplication removes any semantic tracks that already appeared in keyword results.

### components

| component | service | purpose |
|-----------|---------|---------|
| CLAP model | Modal (`plyr-clap`) | generates 512-dim embeddings from audio or text |
| vector store | turbopuffer | stores/queries embeddings with cosine distance |
| search endpoint | FastAPI (`/search/semantic`) | orchestrates embed → query → hydrate |
| backfill script | `scripts/backfill_embeddings.py` | indexes existing tracks |

## services

### Modal CLAP service

**source**: `services/clap/app.py`

hosts the `laion/clap-htsat-unfused` model on Modal with two endpoints:

- `POST /embed_audio` — base64-encoded audio → 512-dim embedding
- `POST /embed_text` — text description → 512-dim embedding

container specs: 2 CPU, 4GB RAM, 5-minute idle timeout (scales to zero).

> **model choice**: we use `clap-htsat-unfused`, not `larger_clap_music`. the "larger" music variant has a broken text projection layer (zero biases, near-zero weights) that collapses all text to the same embedding. `clap-htsat-unfused` produces properly discriminative text embeddings (cosine similarity range -0.01 to 0.50 across different queries).

**deploy**:
```bash
uvx modal deploy services/clap/app.py
```

after deploy, Modal prints the endpoint URLs. set them as Fly secrets:

```bash
fly secrets set \
  MODAL_ENABLED=true \
  MODAL_EMBED_AUDIO_URL=https://<workspace>--plyr-clap-clapservice-embed-audio.modal.run \
  MODAL_EMBED_TEXT_URL=https://<workspace>--plyr-clap-clapservice-embed-text.modal.run \
  -a <fly-app-name>
```

**test**:
```bash
curl -X POST https://<workspace>--plyr-clap-clapservice-embed-text.modal.run \
  -H "Content-Type: application/json" \
  -d '{"text": "dark ambient techno"}'
# → {"embedding": [...], "dimensions": 512}
```

first call is slow (~30s) due to cold start + model download. subsequent calls within 5 minutes are fast.

### turbopuffer

vector database for storing and querying track embeddings.

**env vars**:
```bash
TURBOPUFFER_ENABLED=true
TURBOPUFFER_API_KEY=tpuf_xxxxx
TURBOPUFFER_NAMESPACE=plyr-tracks      # prod: plyr-tracks, staging: plyr-tracks-stg
```

> **namespace naming**: the backfill script writes to whatever `TURBOPUFFER_NAMESPACE` is set to. production uses `plyr-tracks` (not `plyr-tracks-prd`). if you change this, you must re-backfill.

each vector stores:
- `id`: track_id
- `vector`: 512-dim CLAP embedding
- attributes: `title`, `artist_handle`, `artist_did`

the namespace is created automatically on first write. querying a nonexistent namespace returns empty results (not an error).

## indexing

### automatic (new uploads)

when a track is uploaded and both Modal + turbopuffer are enabled, embedding generation is automatically scheduled as a docket background task. see `backend/src/backend/_internal/background_tasks.py` → `generate_embedding`.

### backfill (existing tracks)

```bash
# dry run — shows eligible tracks
uv run scripts/backfill_embeddings.py --dry-run

# index first 5 tracks
uv run scripts/backfill_embeddings.py --limit 5

# full backfill with 10 concurrent workers (default)
uv run scripts/backfill_embeddings.py

# faster with more concurrency (Modal auto-scales containers)
uv run scripts/backfill_embeddings.py --concurrency 20
```

the script downloads audio from R2, generates CLAP embeddings via Modal, and upserts to turbopuffer. uses asyncio concurrency with a semaphore — Modal spins up multiple containers automatically.

requires env vars: `DATABASE_URL`, `R2_PUBLIC_BUCKET_URL`, `MODAL_*`, `TURBOPUFFER_*`.

**important**: if you switch CLAP models, you must re-backfill all tracks. text and audio embeddings must be in the same latent space.

## feature flag

mood search is gated behind the `vibe-search` per-user feature flag. users with the flag get semantic results appended below keyword results in the search modal. without the flag, only keyword search runs.

## cost

| service | backfill (575 tracks) | ongoing per upload | monthly storage |
|---------|----------------------|-------------------|-----------------|
| Modal (CLAP inference) | ~$0.35 | < $0.001 | $0 (scales to zero) |
| turbopuffer (vectors) | — | — | < $0.01 |
| R2 (audio download) | $0 (free egress) | $0 | — |

## environment variables

| variable | purpose | default |
|----------|---------|---------|
| `MODAL_ENABLED` | enable CLAP embedding service | `false` |
| `MODAL_EMBED_AUDIO_URL` | Modal endpoint for audio embeddings | — |
| `MODAL_EMBED_TEXT_URL` | Modal endpoint for text embeddings | — |
| `MODAL_TIMEOUT_SECONDS` | embedding request timeout | `120` |
| `TURBOPUFFER_ENABLED` | enable vector storage | `false` |
| `TURBOPUFFER_API_KEY` | turbopuffer API key | — |
| `TURBOPUFFER_REGION` | turbopuffer API region | `api` |
| `TURBOPUFFER_NAMESPACE` | vector namespace | `plyr-tracks` |

## API

### `GET /search/semantic?q=<query>&limit=10`

no auth required. returns tracks ranked by cosine similarity to the query text.

**requirements**: Modal + turbopuffer enabled, query 3-200 chars, limit 1-50.

**response**:
```json
{
  "results": [
    {
      "type": "track",
      "id": 123,
      "title": "Ambient Waves",
      "artist_handle": "artist.bsky.social",
      "artist_display_name": "Artist Name",
      "image_url": "https://...",
      "similarity": 0.483
    }
  ],
  "query": "dark ambient techno",
  "available": true
}
```

`available: false` when Modal/turbopuffer are disabled or embedding fails. empty `results` with `available: true` means no tracks matched.

### `GET /tracks/{track_id}/recommended-tags?limit=5`

no auth required. recommends genre tags for a track based on ML classification via effnet-discogs on Replicate.

results are cached in `track.extra["genre_predictions"]`. if no predictions are stored and Replicate is enabled, classification runs on-demand. excludes tags the track already has.

**response**:
```json
{
  "track_id": 76,
  "tags": [
    {"name": "Techno", "score": 0.87},
    {"name": "Electronic", "score": 0.72}
  ],
  "available": true
}
```

`available: false` when Replicate is disabled. empty `tags` with `available: true` means classification returned no results or the track has no R2 URL.

## key files

- `services/clap/app.py` — Modal CLAP service
- `backend/src/backend/_internal/clap_client.py` — Modal HTTP client
- `backend/src/backend/_internal/tpuf_client.py` — turbopuffer client
- `backend/src/backend/api/search.py` — `/search/semantic` endpoint
- `backend/src/backend/_internal/background_tasks.py` — `generate_embedding` task
- `scripts/backfill_embeddings.py` — batch indexing script
- `frontend/src/lib/components/SearchModal.svelte` — search UI (mood badge, progressive results)
- `frontend/src/lib/search.svelte.ts` — parallel keyword + semantic dispatch
