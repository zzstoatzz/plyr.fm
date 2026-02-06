# vibe search

semantic search over tracks using CLAP (Contrastive Language-Audio Pretraining) embeddings. users describe a mood or vibe in natural language and get matching tracks ranked by similarity.

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

### components

| component | service | purpose |
|-----------|---------|---------|
| CLAP model | Modal (`plyr-clap`) | generates 512-dim embeddings from audio or text |
| vector store | turbopuffer | stores/queries embeddings with cosine distance |
| search endpoint | FastAPI (`/search/semantic`) | orchestrates embed → query → hydrate |
| backfill script | `scripts/backfill_embeddings.py` | indexes existing tracks |

## services

### Modal CLAP service

**source**: `clap/app.py`

hosts the `laion/larger_clap_music` model on Modal with two endpoints:

- `POST /embed_audio` — base64-encoded audio → 512-dim embedding
- `POST /embed_text` — text description → 512-dim embedding

container specs: 2 CPU, 4GB RAM, 5-minute idle timeout (scales to zero).

**deploy**:
```bash
uvx modal deploy clap/app.py
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
TURBOPUFFER_NAMESPACE=plyr-tracks      # use plyr-tracks-stg for staging
```

each vector stores:
- `id`: track_id
- `vector`: 512-dim CLAP embedding
- attributes: `title`, `artist_handle`, `artist_did`

## indexing

### automatic (new uploads)

when a track is uploaded and both Modal + turbopuffer are enabled, embedding generation is automatically scheduled as a docket background task. see `backend/src/backend/api/tracks/uploads.py`.

### backfill (existing tracks)

```bash
# dry run — shows eligible tracks
uv run scripts/backfill_embeddings.py --dry-run

# index first 5 tracks
uv run scripts/backfill_embeddings.py --limit 5

# full backfill
uv run scripts/backfill_embeddings.py

# custom batch size
uv run scripts/backfill_embeddings.py --batch-size 5
```

the script downloads audio from R2, generates CLAP embeddings via Modal, and upserts to turbopuffer. runs sequentially to be gentle on Modal.

## feature flag

vibe search is gated behind the `vibe-search` per-user feature flag. users with the flag see a "vibe" toggle in the Cmd+K search modal. without the flag, the toggle is hidden and only regular text search is available.

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
      "similarity": 0.873
    }
  ],
  "query": "dark ambient techno"
}
```

returns 503 if Modal/turbopuffer are disabled.

## key files

- `clap/app.py` — Modal CLAP service
- `backend/src/backend/_internal/clap_client.py` — Modal HTTP client
- `backend/src/backend/_internal/tpuf_client.py` — turbopuffer client
- `backend/src/backend/api/search.py` — `/search/semantic` endpoint
- `backend/src/backend/_internal/background_tasks.py` — `generate_embedding` task
- `scripts/backfill_embeddings.py` — batch indexing script
- `frontend/src/lib/components/SearchModal.svelte` — vibe toggle UI
- `frontend/src/lib/search.svelte.ts` — semantic search state
