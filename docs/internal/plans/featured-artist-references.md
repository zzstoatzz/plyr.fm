---
title: "fix featured-artist references (drift-prone schema)"
date: 2026-05-02
status: proposed
tracks: zzstoatzz/plyr.fm#1355
---

## context

#1355 surfaced a visible bug: track 918 ("infinite earth") renders
"feat." with no name. Three tracks have the same problem (918, 938, 88).

The visible cause is trivial — frontend reads `feature.display_name` but
the API returns `displayName` for these three rows.

The **deeper** cause is that we're denormalizing identity metadata into
both the PDS record AND the DB row, and the dual paths writing it
disagree on case convention. Even if we normalized the case, this design
produces drift on every handle change, every display-name change, every
profile-picture change. It's the wrong shape regardless of the case bug.

## what we measured

| | value |
|---|---|
| tracks in our DB with `features` | 51 |
| distinct artists | 7 |
| camel-only (broken) rows | 3 |
| repos in the wild publishing `fm.plyr.track` | 74 |
| repos in wild not in our DB | 8 (sampled — none use `features`) |

Our DB covers every track in the wild that uses `features`. No external
clients are writing `features` in unexpected shapes.

Per-artist distribution of feature-using tracks:

| artist | tracks | broken (camel-only) |
|---|---|---|
| pyxorium.com | 41 | 0 |
| psingletary.com | 2 | 1 |
| shi.gg | 2 | 0 |
| zzstoatzz.io | 2 | 0 |
| darkhart.bsky.social | 2 | 1 |
| just.cameron.stream | 1 | 1 |
| goose.art | 1 | 0 |

## what the lexicon spec lets us do

From `atproto.com/specs/lexicon`:

- ✗ Cannot remove `featuredArtist.handle` (it's currently required)
- ✗ Cannot rename `displayName` → `display_name`
- ✗ Cannot change types
- ✓ Can add new optional fields
- ✓ For larger breaks: a brand-new NSID

A new NSID is **off the table** — it's ecosystem-splitting and out of
proportion to the problem.

Unilaterally rewriting users' PDS records using stored OAuth sessions is
**off the table** — users own their repos, full stop.

## design

### where canonical state lives

| layer | what it stores | shape |
|---|---|---|
| PDS record (lexicon) | published, denormalized snapshot for portability | `features: [{did, handle, displayName}, ...]` (current shape, lexicon-conformant) |
| our DB | stable identifier only | `features: list[{did}]` (or `list[str]` of DIDs) |
| profile resolver (new layer) | hydrates DID → live profile | memoized `resolve_did(did) -> {handle, display_name, avatar_url}` |
| API response | hydrated view, fresh on every read | `features: list[FeaturedArtist]` (Pydantic, snake_case) |

The DB stops being a snapshot of stale display data. It becomes a list of
stable references. Display data is computed at read time and is therefore
always current.

### lexicon change: relax `featuredArtist.required`

The lexicon currently requires `did` AND `handle`. We relax it to require
only `did`, and mark `handle` and `displayName` as deprecated in their
property descriptions:

```json
"featuredArtist": {
  "required": ["did"],
  "properties": {
    "did":         { "format": "did", "description": "Canonical, stable identifier." },
    "handle":      { "description": "DEPRECATED snapshot — mutable, may be stale. Resolve from did." },
    "displayName": { "description": "DEPRECATED snapshot — mutable, may be stale. Resolve from did." }
  }
}
```

This is technically a soft violation of the spec's "new data must
validate under old lexicon" rule (a record omitting `handle` would fail
strict validation against the old version). In practice nobody validates
against cached old lexicons — atproto consumers fetch the live version
on demand, and most are permissive about extra/missing fields. The
audience that would actually trip on this is approximately empty.

We accept that minor break because the alternatives are worse:
- doing nothing leaves the lexicon encouraging drift-prone snapshot
  storage forever
- adding a new optional `featureDids` field doubles the surface (two
  valid shapes, both must be maintained) for no real benefit since
  `features[].did` is already the canonical pointer
- minting a new NSID is ecosystem-splitting and out of proportion to the
  problem

We continue to populate `handle` and `displayName` on every write
(resolved fresh from the DID) so the published record stays compatible
with permissive readers and the snapshot is accurate as of publish.
Eventually we can stop emitting them entirely; the lexicon already says
they're optional, so we'll be conformant.

### why we don't backfill PDS records

The 51 PDS records in the wild are owned by their artists, not by us. We
won't touch them. They'll naturally update next time the user edits the
track through plyr.fm. In the meantime:

- Our API renders correctly because the resolver hydrates from DIDs (the
  one stable thing every record already has)
- The lexicon-required `handle` snapshot in the PDS record stays
  potentially stale, but that's a property of the lexicon and applies to
  any consumer, not just us
- Any consumer that wants fresh data resolves DIDs themselves, the same
  way we will

## migration

Five changes, ordered by dependency:

### 1. profile resolver (`backend/_internal/atproto/profiles.py`)

Formalize `_internal/atproto/handles.py:resolve_handle()` into a
DID-keyed memoized resolver:

```python
async def resolve_did(did: str) -> ResolvedProfile | None:
    """returns {did, handle, display_name, avatar_url} for a DID.

    resolution order:
      1. plyr.fm artists table (single SQL hit, current handle/display via JOIN)
      2. in-process LRU cache (TTL ~5min)
      3. live bsky.app getProfile fallback
    """
```

Also expose a batched `resolve_dids(dids)` for the common API path that
needs to hydrate N features at once.

### 2. DB migration (alembic)

Migration that rewrites every `tracks.features` row from
`[{did, handle, ...}, ...]` to `[{did: "..."}, ...]` — keep only the DID,
drop everything else. ~51 rows touched.

```sql
UPDATE tracks
SET features = (
  SELECT jsonb_agg(jsonb_build_object('did', f->>'did'))
  FROM jsonb_array_elements(features) f
)
WHERE features IS NOT NULL AND jsonb_array_length(features) > 0;
```

Backward-compat tolerated by readers below — but the migration makes the
DB consistent in one shot.

### 3. ingest path (`backend/_internal/tasks/ingest.py:256, :359`)

Replace `features = record.get("features") or []` with:

```python
features = [
    {"did": f["did"]}
    for f in (record.get("features") or [])
    if isinstance(f, dict) and f.get("did")
]
```

Tolerates either snake or camel snapshot shape since we only read `did`.
This eliminates the round-trip drift bug at its source.

### 4. API response (`backend/src/backend/schemas.py:98`)

Change `TrackResponse.features` from `list[dict[str, Any]]` to
`list[FeaturedArtist]` — populated server-side by passing the DID list
through `resolve_dids()`. The frontend's existing field expectations
(`display_name`, snake_case) are now the type-system-enforced contract.

### 5. PDS write path (`backend/_internal/atproto/records/fm_plyr/track.py:71-78`)

Keep emitting `{did, handle, displayName}` per the lexicon, but populate
the `handle` and `displayName` from the resolver each write — so the
record snapshot is at least correct as of publish time. Drop the
`f.get("display_name", f["handle"])` fallback; resolve fresh.

## what does NOT change

- frontend code (same field names in the API response)
- the lexicon (no version bump, no new optional field — yet)
- existing PDS records in the wild (we never touch them; they update
  organically when the artist next edits a track via plyr.fm)
- SDK / MCP (the API contract is unchanged)

## what fixes the visible bug

After step 4 lands, all three currently-broken tracks (918, 938, 88)
render correctly because the resolver populates `display_name` from the
artist's current bsky profile, regardless of what shape was sitting in
the DB row.

After step 2 lands, the underlying DB inconsistency is gone. Steps 3
and 5 prevent it from recurring.

## non-goals (deliberate)

- adding `featureDids` to the lexicon (no parallel field — relaxing the
  required-array on the existing `featuredArtist` def is sufficient)
- minting a new NSID
- backfilling PDS records via stored OAuth sessions
- any frontend changes

## acceptance

- track 918 / 938 / 88 render with the featured artist's current name
- handle/display-name changes by featured artists are reflected in
  plyr.fm's UI without any republish
- ingest of any new `fm.plyr.track` PDS record (any feature shape) lands
  as `[{did: ...}]` in our DB
- PDS records we author have current `handle` / `displayName` snapshots
  as of write time
