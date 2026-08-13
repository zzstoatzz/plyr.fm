# Zig v1 playlist resources

Public playlist reads are projections of authenticated `fm.plyr.list` records
whose `listType` is `playlist`. They do not treat the Python `playlists` table,
cached counts, cover fields, or a live PDS fetch as content authority.

## collection

`GET /v1/playlists` discovers public verified playlists globally. An optional
canonical `owner_did` narrows the collection to one account. `limit` is 1–100
and pagination uses `next_cursor`; unknown or duplicate query parameters are
invalid.

The cursor encodes the authored timestamp and canonical list URI and is bound to
the complete query scope. A global cursor cannot be replayed into an owner query,
and a cursor for one owner cannot be replayed for another. Ordering is authored
`createdAt` descending, then canonical URI descending.

Each summary returns canonical record identity, authored name/timestamps, owner
identity and optional projected profile, member/availability/play aggregates,
projection proof, and per-family provenance. App-local cover art,
`show_on_profile`, local UUIDs, cached counts, and privacy flags are excluded.

## detail

`GET /v1/playlists/{playlist_id}` reverses the `pls_` identifier to the canonical
AT URI and requires the configured environment's list collection. The response
contains every signed strong-reference position in order. A member hydrates only
when the independently authenticated track projection has the exact URI and CID
and passes account, access, moderation, and artist-availability policy. All other
conditions produce the same `availability: unavailable` and `track: null`, so
the API neither compacts signed order nor leaks why a track is hidden.

The Postgres adapter performs one bounded joined read and reuses the standalone
composed-track decoder. This prevents list hydration from acquiring a subtly
different track representation or policy.

## local baseline

Recorded 2026-08-09 on an Apple M5 Pro with Zig 0.16.0, ReleaseFast, and the
guarded disposable Postgres 14 `zig_bench` fixture. The collection returns one
1,016-byte verified summary; detail returns 20 ordered, fully hydrated members
in 44,245 bytes:

| resource | concurrency | responses/s | p50 | p95 | p99 | RSS | errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| collection | 1 | 264.9 | 3.694 ms | 5.847 ms | 6.679 ms | 3,568 KiB | 0 |
| collection | 16 | 2,595.4 | 5.675 ms | 9.614 ms | 13.652 ms | 4,704 KiB | 0 |
| detail | 1 | 287.7 | 3.105 ms | 5.668 ms | 6.868 ms | 3,504 KiB | 0 |
| detail | 16 | 3,042.1 | 4.621 ms | 10.141 ms | 16.117 ms | 6,400 KiB | 0 |

Run `just zig bench-playlists` to recreate the fixture and all four
measurements. The command refuses destructive setup outside `zig_bench`. These
are local regression baselines, not Neon or Fly capacity claims.

## compatibility and deliberate gaps

These resources replace the useful public behavior spread across Python's
playlist-by-owner, ID, metadata, AT-URI, and generic list resolver routes. The v1
client uses canonical opaque IDs and one detail resource instead of local UUIDs,
separate metadata calls, or a resolver hop.

Private playlists are currently app-local and have no public ATProto record;
anonymous v1 reads never expose them. Session-aware private storage,
source-authoritative create/update/delete commands, covers and preview images,
recommendations, liked lists, and profile-presentation preferences remain
separate capabilities. They must not be added by making the verified read model
depend on legacy playlist rows.
