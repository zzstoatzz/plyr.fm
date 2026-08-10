---
title: "Zig v1 verified track likes"
---

`GET /v1/tracks/{track_id}/likes` reads public interaction records as an
appview index, not as application-owned social state. The route first resolves
the opaque track ID through the normal verified track boundary, then queries
only live `fm.plyr.*.like` records whose subject URI **and subject CID** match
that current record.

An AT URI identifies a mutable repository slot. A like contains a strong
reference to one value in that slot, so a like for an earlier CID must not move
to a replacement track revision merely because the URI stayed stable. The same
rule now applies to track-chart aggregation. The disposable fixture seeds 100
stale-CID likes against a track with one current-CID like and proves that both
the public list and chart see only the latter.

The response is a strict, cursor-paginated v1 resource. Each item keeps the
like record identity and commit proof, exact subject reference, actor DID,
optional presentation profile, account-availability evidence, and provenance
separate. Legacy `track_likes` rows cannot admit a result. An unavailable actor
is absent because its repository is no longer currently readable; missing
legacy presentation data does not suppress an otherwise authenticated record.

The application layer depends only on `TrackStore` and `LikeQueryStore` ports.
The PostgreSQL adapter currently reads `plyr_index.like_records`, verified
account availability, verified profile records, and optional legacy profile
presentation. A replacement schema can implement the same ports without
changing HTTP or domain semantics.

Run `just zig test-postgres` for the adapter contract and
`just zig bench-track-likes` for full HTTP verification plus native
`ReleaseFast` measurements. On the August 10 fixture (20 records per response),
the initial native run produced 533.6 requests/s at concurrency 1 and 3,942.9
requests/s at concurrency 16, with zero errors; RSS was 4.8 MiB and 20.6 MiB,
respectively. These numbers are a reproducible endpoint baseline, not a
Python-parity comparison.

Mutation is deliberately separate. A future like or unlike operation may
report success only after the user's PDS accepts the record operation. It must
not recreate the Python backend's local-first database write followed by a
best-effort background PDS write.
