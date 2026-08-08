---
title: "DASL media identity and Streamplace prior art"
---

## purpose

This note records the protocol properties that constrain plyr.fm's Zig media
model. It is not a commitment to MUXL for every audio object. It is a commitment
not to confuse content identity, authored claims, retrieval, and availability.

## DASL and DRISL

[DASL](https://dasl.ing/) is a small content-addressed namespace shared by raw
bytes and structured documents. Its CID profile is intentionally narrow:

- CIDv1 encoded as lowercase, unpadded base32 with a `b` multibase prefix;
- raw (`0x55`) or DRISL (`0x71`) content codec;
- SHA-256 (`0x12`) with a 32-byte digest.

[DRISL](https://dasl.ing/drisl.html) is deterministic CBOR. It permits only
string map keys, finite values, a constrained numeric/simple-value surface, and
CBOR tag 42 for binary CID links. Equal structured values therefore encode to
equal bytes and receive the same CID. It is appropriate for bounded metadata,
not streaming media.

[MASL](https://dasl.ing/masl.html) places a DRISL metadata document between a
resource and consumers. Its `src` is the raw resource CID; media type and other
metadata remain self-certifying because they are inside the DRISL document.

[RASL](https://dasl.ing/rasl.html) makes the separation operational. The CID is
the URL authority and hosts are optional retrieval hints. A client may fetch
from an untrusted host, but it must compute and compare the returned CID before
accepting the bytes.

[BDASL](https://dasl.ing/bdasl.html) substitutes BLAKE3 (`0x1e`) for large media
where streaming verification matters. It is a deliberate extension rather than
the default open-web CID profile.

## Streamplace's concrete split

The reviewed Streamplace revision is
[`b6e7c43d`](https://github.com/streamplace/streamplace/tree/b6e7c43d84e14d7c03cb7a6f6eed035c5cf9aeeb).

Streamplace represents four distinct things:

1. A user-owned `place.stream.media.track` record identifies a MUXL artifact by
   BDASL CID, identifies its in-container track, and may name an ephemeral
   signing key and parent/source record.
2. A server-owned `place.stream.media.origin` record attests that the server
   currently hosts a CID. Many server attestations may name the same artifact.
3. The appview stores track and origin records separately, including their
   record bytes, record CID, owner DID, and `indexed_at`.
4. The transfer path streams remote bytes into staged storage, hashes them as
   they arrive, and completes the write only after the computed CID matches.

Important implementation references:

- [`pkg/vod/publish.go`](https://github.com/streamplace/streamplace/blob/b6e7c43d84e14d7c03cb7a6f6eed035c5cf9aeeb/pkg/vod/publish.go)
  publishes origins in the server repo and tracks in the user's repo.
- [`pkg/model/media_track.go`](https://github.com/streamplace/streamplace/blob/b6e7c43d84e14d7c03cb7a6f6eed035c5cf9aeeb/pkg/model/media_track.go)
  indexes authored track records with an ingest timestamp.
- [`pkg/model/media_origin.go`](https://github.com/streamplace/streamplace/blob/b6e7c43d84e14d7c03cb7a6f6eed035c5cf9aeeb/pkg/model/media_origin.go)
  indexes hosting attestations independently.
- [`pkg/vod/transfer.go`](https://github.com/streamplace/streamplace/blob/b6e7c43d84e14d7c03cb7a6f6eed035c5cf9aeeb/pkg/vod/transfer.go)
  demonstrates verify-before-visible storage.

## plyr.fm v1 consequence

The v1 response uses `media.artifacts` and `media.origins`. An artifact is a CID
claim; an origin is a retrieval claim. The legacy Python row supplies neither a
signed origin attestation nor a persisted proof that the R2 URL still serves the
declared CID, so the adapter leaves that relationship null.

The Zig `internal/content/cid.zig` module validates the exact DASL/BDASL framing
we accept. Future ingestion and mirroring code can share it for streaming
verification rather than inventing storage-specific hashes.
