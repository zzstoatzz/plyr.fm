# research: Streamplace media architecture

**date**: 2026-05-28
**question**: What can plyr.fm learn from `streamplace/streamplace`, especially around DASL/MUXL/S2PA and the blocker for artist DID signing?

## summary

Streamplace is directly relevant prior art. It separates top-level creative records from media-track records, stores MUXL artifacts by BDASL CID, serves playback through collection-agnostic XRPC endpoints, and solves the "creator DID signing" problem with repo-authorized delegated `did:key` signing keys rather than direct access to the creator account DID key.

For plyr.fm, the clean lesson is: do not phrase the goal as "the artist DID signs media bytes" unless we have a real DID signing surface. Phrase it as "the artist repo authorizes a media signing key, and media artifacts carry signatures from that delegated key" or, for service-produced derivatives, "the service produces an ephemeral signed artifact and the artist repo records reference it."

## findings

### Delegated signing key model

- `place.stream.key` is a user repo record that links an ATProto identity to a stream signing `did:key`; it requires `signingKey` and `createdAt` (`/tmp/streamplace-study/lexicons/place/stream/key.json:7`, `/tmp/streamplace-study/lexicons/place/stream/key.json:11`).
- The client generates an exportable secp256k1 keypair, combines the private key material with the user's DID into a stream key, then writes the public `did:key` into the user's PDS as a `place.stream.key` record (`/tmp/streamplace-study/js/components/src/livestream-store/stream-key.tsx:41`, `/tmp/streamplace-study/js/components/src/livestream-store/stream-key.tsx:80`).
- Streamplace docs describe the verification loop explicitly: the public key lives in the user's PDS, nodes sync it from the firehose, stream requests include the private stream key, and the node verifies that the public key exists before signing segments (`/tmp/streamplace-study/js/docs/src/content/docs/video-metadata/signing.md:10`, `/tmp/streamplace-study/js/docs/src/content/docs/video-metadata/signing.md:24`).
- Validation does not require the account DID private key. It extracts the embedded C2PA signing cert's `did:key`, syncs the creator repo, and checks whether that `did:key` is authorized for the creator DID (`/tmp/streamplace-study/pkg/media/validate.go:86`, `/tmp/streamplace-study/pkg/media/validate.go:99`).

This clarifies our blocker: artist DID signing is blocked by key authority and signing surface, not cryptography. ATProto OAuth lets plyr.fm ask the artist PDS to write records; it does not give plyr.fm the artist account private key for arbitrary S2PA/C2PA media signatures. Streamplace's solution is a delegated media key attested by the artist repo.

### VOD uses a weaker but useful per-upload provenance model

- For VOD uploads, Streamplace generates a fresh per-upload secp256k1 keypair, creates an ES256K cert, signs segments, and does not persist the private key (`/tmp/streamplace-study/pkg/vod/signing.go:13`, `/tmp/streamplace-study/pkg/vod/signing.go:27`).
- During VOD processing, the upload signer is generated when muxing starts, used to sign every segment, then dropped when processing returns (`/tmp/streamplace-study/pkg/vod/process.go:172`, `/tmp/streamplace-study/pkg/vod/process.go:176`).
- The output is hashed with BDASL while being written, and the final content key is based on the BDASL CID (`/tmp/streamplace-study/pkg/vod/process.go:161`, `/tmp/streamplace-study/pkg/vod/process.go:224`).
- Published media track records include the MUXL blob CID, size, track id, media type, and signing key (`/tmp/streamplace-study/pkg/vod/publish.go:198`, `/tmp/streamplace-study/pkg/vod/publish.go:203`, `/tmp/streamplace-study/pkg/vod/publish.go:207`).

This is not the same as "the artist signed the upload" unless the ephemeral key is also artist-authorized. It is still useful: it proves a particular processed artifact was produced once under a key that no longer exists, and the artist repo can reference that artifact.

### Media records are artifact records, not just URLs

- `place.stream.media.defs#sourceTracks` makes a video's canonical source a list of strongRefs to media track records (`/tmp/streamplace-study/lexicons/place/stream/media/defs.json:5`, `/tmp/streamplace-study/lexicons/place/stream/media/defs.json:10`).
- `place.stream.media.defs#muxlTrack` models a MUXL-backed track with `blob`, `trackId`, `mediaType`, and optional `signingKey` (`/tmp/streamplace-study/lexicons/place/stream/media/defs.json:40`, `/tmp/streamplace-study/lexicons/place/stream/media/defs.json:43`, `/tmp/streamplace-study/lexicons/place/stream/media/defs.json:65`).
- `place.stream.media.track` is a standalone record for source tracks and derived tracks; derived tracks can point at a source video and parent track (`/tmp/streamplace-study/lexicons/place/stream/media/track.json:7`, `/tmp/streamplace-study/lexicons/place/stream/media/track.json:17`, `/tmp/streamplace-study/lexicons/place/stream/media/track.json:22`).
- `place.stream.media.origin` is a hosting-node attestation that a MUXL blob is available for download by XRPC. It is published by the node hosting the blob, not by the user owning the video (`/tmp/streamplace-study/lexicons/place/stream/media/origin.json:7`).

This strongly supports adding a plyr.fm media artifact layer instead of stretching `fm.plyr.track.audioUrl` / `audioBlob`. A track or recording can describe music; media artifact records can describe source bytes, transcodes, MUXL blobs, segment manifests, hashes, signing keys, and derivation edges.

### Playback is AT-URI in, content-addressed bytes out

- `place.stream.playback.getVideoPlaylist` accepts an AT-URI for a playable record and returns HLS CMAF, with the design intentionally collection-agnostic for future record types (`/tmp/streamplace-study/lexicons/place/stream/playback/getVideoPlaylist.json:7`, `/tmp/streamplace-study/lexicons/place/stream/playback/getVideoPlaylist.json:12`).
- `place.stream.playback.getVideoBlob` fetches content-addressed MUXL blobs by CID, honors HTTP Range, and treats the `did` as egress attribution rather than access control (`/tmp/streamplace-study/lexicons/place/stream/playback/getVideoBlob.json:7`, `/tmp/streamplace-study/lexicons/place/stream/playback/getVideoBlob.json:12`).

For plyr.fm, this points away from permanent raw stream URLs and toward:

- an AT-URI for the playable thing;
- strongRefs from playable records to media artifacts;
- CID-addressed bytes;
- playlist/blob XRPCs that can evolve independently of the creative record shape.

## implications for plyr.fm

1. Create a first-class media artifact lexicon rather than forcing all media concerns into `fm.plyr.track`.
2. Model signer semantics explicitly:
   - `serviceSigned`: plyr.fm generated/controlled signing key;
   - `artistRepoAuthorizedKey`: artist repo contains a key-authorization record;
   - `artistAccountSigned`: only if a real account-DID signing surface exists.
3. Consider a `fm.plyr.media.key` record analogous to `place.stream.key`, with lifecycle fields for creation, purpose, scope, optional expiration, and revocation semantics.
4. Consider `fm.plyr.media.artifact` records for source uploads and derived playback outputs, with BDASL CID, byte length, MIME/container/codec metadata, signing key DID, parent artifact strongRef, and origin/availability records.
5. For the first implementation, service-produced upload artifacts can use ephemeral per-upload signing keys, while a later "artist-authorized media key" flow can strengthen authorship claims.

## code references

- `lexicons/place/stream/key.json:7` - `place.stream.key` links an ATProto identity to a stream signing key.
- `js/components/src/livestream-store/stream-key.tsx:41` - Streamplace client generates an exportable secp256k1 keypair.
- `js/components/src/livestream-store/stream-key.tsx:80` - client writes the public `did:key` to the user's repo as `place.stream.key`.
- `js/docs/src/content/docs/video-metadata/signing.md:10` - docs describe key generation and PDS distribution.
- `pkg/media/validate.go:99` - validator checks embedded signing `did:key` against creator repo authorization.
- `pkg/vod/signing.go:13` - VOD upload signer is per-upload ephemeral key material.
- `pkg/vod/process.go:161` - VOD output is hashed with BDASL while writing.
- `pkg/vod/publish.go:198` - VOD publishes media track records with MUXL blob/signing key metadata.
- `lexicons/place/stream/media/defs.json:40` - MUXL-backed track object.
- `lexicons/place/stream/media/track.json:22` - derived tracks can reference a parent track.
- `lexicons/place/stream/media/origin.json:7` - hosting-node availability attestation.
- `lexicons/place/stream/playback/getVideoPlaylist.json:7` - playlist query accepts playable AT-URI and emits HLS CMAF.
- `lexicons/place/stream/playback/getVideoBlob.json:7` - blob query serves content-addressed MUXL bytes by CID.

## open questions

- Should plyr.fm's first delegated media key be generated client-side, server-side per upload, or both depending on provenance strength?
- Should a media key authorization be scoped to a single upload/artifact CID, a recording, a release, or all future uploads until revoked?
- Can S2PA signatures embed the same delegated `did:key` pattern cleanly, or do we need an additional ATProto record that binds S2PA manifests to repo-authorized keys?
- How much of Streamplace's BDASL/MUXL code can be reused directly for audio-only artifacts, versus treated as spec/architecture guidance?
