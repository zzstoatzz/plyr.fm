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

The common track representation exposes `metrics.like_count` from the same
exact-CID and available-account boundary. It counts distinct actor DIDs, so
duplicate records from one repository cannot inflate the number. This makes
the existing next frontend's count, tooltip, and mobile liker sheet agree with
the record resource. The frontend adapter validates record provenance before
mapping presentation fields and keeps every like/unlike control disabled; this
slice is read-only.

Both the record resource and aggregate are additionally scoped to the
environment's configured like NSID. A projection can temporarily contain
records from more than one namespace during reconciliation; those rows do not
become plyr likes merely because they name the same track strong reference.

The application layer depends only on `TrackStore` and `LikeQueryStore` ports.
The PostgreSQL adapter currently reads `plyr_index.like_records`, verified
account availability, verified profile records, and optional legacy profile
presentation. A replacement schema can implement the same ports without
changing HTTP or domain semantics.

Run `just zig test-postgres` for the adapter contract and
`just zig bench-track-likes` for full HTTP verification plus native
`ReleaseFast` measurements. On the August 10 fixture (20 records per response),
the latest native run produced 617.9 requests/s at concurrency 1 and 4,216.6
requests/s at concurrency 16, with zero errors; RSS was 4.8 MiB and 23.3 MiB,
respectively. With exact like counts included, the 50-track collection produced
165.1 and 1,580.8 requests/s at concurrency 1 and 16; single-track detail
produced 977.1 and 6,364.1 requests/s. These numbers are reproducible endpoint
baselines, not a Python-parity comparison.

Mutation is deliberately separate. `PUT /v1/tracks/{track_id}/like` and
`DELETE /v1/tracks/{track_id}/like` report success only after the user's PDS accepts
the record operation; they never recreate the Python backend's local-first
database write followed by a best-effort background PDS write. Receipts expose
whether the verified projection has caught up.

Viewer state is separate again. `POST /v1/me/likes/resolve` accepts at most 100
opaque track IDs paired with their current record CIDs, verifies every decoded
track URI and DAG-CBOR CID, and resolves all exact strong references for the
authenticated DID in one PostgreSQL query. Anonymous requests receive `401`,
credentialed requests require the exact frontend origin, and successful
responses are `no-store`. This keeps public track resources viewer-independent
and cacheable while avoiding one query or HTTP request per track. The next
frontend performs this one batch after each catalogue page and treats `401` as
the anonymous all-false state.

`GET /v1/me/likes` is the corresponding authenticated collection. It joins the
viewer’s live verified like records to the current track URI **and CID**, picks
the newest record when one repository contains duplicates, and hydrates the
same composed track representation in one query. Stale-CID likes cannot make a
new track revision appear liked. Its keyset cursor is bound to the viewer DID,
success is `no-store`, private tracks are visible only to their owning viewer,
and sensitive tracks remain excluded for non-owners until saved viewer
moderation preferences have their own verified application boundary. The next
frontend follows the bounded pages for library and download workflows rather
than preserving the former hardcoded empty result.
