# genre classification

ML-based genre classification for tracks using the [effnet-discogs](https://replicate.com/mtg/effnet-discogs) model on Replicate.

## architecture

```
track uploaded (or on-demand request)
        |
        v
  Replicate API
  (effnet-discogs, CPU, ~2s)
        |
        v
  genre predictions JSON
  (top N labels + confidence scores)
        |
        v
  stored in track.extra["genre_predictions"]
```

### how it works

1. audio URL is sent to Replicate's effnet-discogs model
2. model returns genre labels from the [Discogs taxonomy](https://www.discogs.com/search/) with confidence scores
3. raw labels use `Genre---Subgenre` format (e.g., `Electronic---Ambient`) — we clean these to `subgenre genre` lowercase (`ambient electronic`)
4. predictions are stored in `track.extra["genre_predictions"]` as JSON

### when classification runs

- **on upload**: if `REPLICATE_ENABLED=true`, classification is scheduled as a docket background task after upload
- **on demand**: `GET /tracks/{id}/recommended-tags` classifies on the fly if no stored predictions exist
- **backfill**: `scripts/backfill_genres.py` processes existing tracks

## API

### `GET /tracks/{track_id}/recommended-tags?limit=5`

no auth required. returns genre predictions for a track, excluding tags the track already has.

**response**:
```json
{
  "track_id": 668,
  "tags": [
    {"name": "audiobook non-music", "score": 0.2129},
    {"name": "spoken word non-music", "score": 0.1817},
    {"name": "monolog non-music", "score": 0.1227}
  ],
  "available": true
}
```

- `available: false` when Replicate is disabled
- empty `tags` with `available: true` means the track has no R2 URL or classification returned no results
- `score` is the model's confidence (0-1)

## storage format

predictions are stored in `track.extra["genre_predictions"]`:

```json
[
  {"name": "ambient electronic", "confidence": 0.1999},
  {"name": "experimental electronic", "confidence": 0.1673},
  {"name": "synth-pop electronic", "confidence": 0.122}
]
```

once classified, the predictions are cached — subsequent API requests read from the database without calling Replicate again.

## backfill

```bash
# dry run — shows eligible tracks (missing genre_predictions in extra)
uv run scripts/backfill_genres.py --dry-run

# classify first 5 tracks
uv run scripts/backfill_genres.py --limit 5

# full backfill with custom concurrency
uv run scripts/backfill_genres.py --concurrency 10
```

requires env vars: `DATABASE_URL`, `REPLICATE_ENABLED=true`, `REPLICATE_API_TOKEN`.

## environment variables

| variable | purpose | default |
|----------|---------|---------|
| `REPLICATE_ENABLED` | enable genre classification | `false` |
| `REPLICATE_API_TOKEN` | Replicate API token | — |
| `REPLICATE_TOP_N` | number of predictions to keep | `10` |
| `REPLICATE_TIMEOUT_SECONDS` | request timeout | `120` |

## cost

effnet-discogs runs on CPU at ~$0.00019/run (~$0.11 per 575 tracks). Replicate scales to zero when idle.

## model details

- **model**: [mtg/effnet-discogs](https://replicate.com/mtg/effnet-discogs) (EfficientNet trained on Discogs)
- **taxonomy**: Discogs genre/subgenre labels (~400 categories)
- **inference**: CPU, ~2s per track
- **SDK note**: the `replicate` Python SDK is incompatible with Python 3.14 (pydantic v1 dependency). we use httpx directly against the Replicate HTTP API with `Prefer: wait` for synchronous predictions.

## key files

- `backend/src/backend/_internal/replicate_client.py` — Replicate HTTP client
- `backend/src/backend/_internal/background_tasks.py` — `classify_genres` task
- `backend/src/backend/api/tracks/tags.py` — `recommended-tags` endpoint
- `backend/src/backend/config.py` — `ReplicateSettings`
- `scripts/backfill_genres.py` — batch classification script
