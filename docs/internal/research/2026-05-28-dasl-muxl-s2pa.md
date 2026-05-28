# research: DASL MUXL and S2PA for plyr.fm

**date**: 2026-05-28
**question**: how should MUXL and S2PA affect plyr.fm, assuming DASL is intended to become an ATProto-adjacent media standard?

## summary

MUXL and S2PA are directly relevant to plyr.fm's next media architecture step. The strongest move is not to squeeze segmented playback into `audioUrl`, but to add a media artifact layer: track records describe music; media records describe canonical source bytes, deterministic derived playback artifacts, segment manifests, hashes, and provenance signatures.

## findings

### MUXL changes the target for segmented audio

- MUXL defines deterministic ISO-BMFF/CMAF fragments and segments for stable content-addressed media identifiers. Its segments are self-contained `.m4s`-style signing/hash targets with DRISL-encoded catalog data in a `uuid` box.
- For audio-only streams, MUXL recommends 1-second segment boundaries. This fits plyr.fm's long-audio cost problem in issue #1457 better than our current single-file playback model.
- MUXL presentation formats synthesize fMP4 or flat MP4 headers without mutating the canonical segment bytes. This is the useful split for plyr.fm: store canonical verifiable media artifacts; serve compatibility presentations to browsers.
- Current playback resolves a single `file_id` to `/audio/{file_id}`, then relies on `<audio src=...>` (`frontend/src/lib/audio-source.ts:50`, `frontend/src/lib/components/player/Player.svelte:388`). A MUXL/HLS-style bundle needs source resolution to return a playback mode, not just one URL.

### Our current content addressing is incomplete for media artifacts

- R2 keys are already content-derived, but only from the exact bytes being stored and truncated to 16 hex chars (`backend/src/backend/storage/r2.py:155`, `backend/src/backend/utilities/hashing.py:11`).
- `file_id` therefore identifies a specific current object such as MP3, WAV, or M4A, not a canonical source, deterministic transcode, segment set, or manifest.
- The model already separates playable and original audio (`backend/src/backend/models/track.py:30`, `backend/src/backend/models/track.py:34`), and the AIFF path now publishes an interim WAV while preserving the lossless original and later swapping to MP3 (`backend/src/backend/api/tracks/uploads.py:595`, `backend/src/backend/api/tracks/audio_optimize.py:1`). That is a good starting point, but it is not yet a first-class artifact graph.
- Issue #614 already names the missing piece: external blob references need full hashes and a standard reference shape, not opaque URLs.

### `fm.plyr.track` is carrying too many media roles

- The current lexicon makes `title`, `artist`, `fileType`, and `createdAt` required, with optional `audioUrl` and `audioBlob` (`lexicons/track.json:11`, `lexicons/track.json:25`, `lexicons/track.json:75`).
- Documentation says `audioBlob` is canonical and `audioUrl` is CDN fallback (`docs/public/lexicons/overview.md:62`), but the recent optimize flow already creates a temporary state where the record has `audioUrl` only, then later gains canonical MP3 blob information.
- A MUXL-aware shape should separate:
  - musical work/recording metadata
  - canonical source asset
  - derived playback artifacts
  - segment manifests and hashes
  - provenance attestations
- Trying to put all of that into `fm.plyr.track.audioUrl` would make the old field mean too many things. A new record family is cleaner.

### S2PA maps naturally to DID-bound provenance, but signer semantics need product design

- S2PA adds secp256k1 signing and DID-derived self-signed X.509 leaf certificates to C2PA, which matches ATProto's DID world much better than CA-rooted C2PA.
- plyr.fm already has secp256k1 signing precedent in the moderation labeler (`services/moderation/src/labels.rs:8`, `services/moderation/src/labels.rs:102`) and DID-bound artist identity throughout the track model (`backend/src/backend/models/track.py:44`).
- The signing split should probably be:
  - artist DID signs authorship or upload intent when we can get a user-controlled signing flow
  - plyr.fm service DID signs transformation/provenance claims: "these MUXL segments were derived from this uploaded source with this pipeline"
  - optional future third-party labeler/rightsholder DIDs sign rights or moderation attestations
- Until user-agent signing is solved, service signing is still valuable because it makes transforms auditable without pretending plyr.fm is the artist.

### A media artifact record is the likely primitive

Candidate direction:

```json
{
  "$type": "fm.plyr.media.artifact",
  "kind": "audio",
  "role": "source | playback | segmentManifest | presentation",
  "codec": "mp3 | pcm_s16le | aac | opus | muxl",
  "container": "mp3 | wav | mp4 | muxl-segment-list",
  "byteLength": 123456,
  "cid": { "$link": "b..." },
  "hash": {
    "algorithm": "sha-256",
    "digest": "..."
  },
  "url": "https://audio.plyr.fm/...",
  "derivedFrom": {
    "uri": "at://did:.../fm.plyr.media.artifact/...",
    "cid": "b..."
  },
  "createdAt": "2026-05-28T00:00:00Z"
}
```

Then either:

```json
{
  "$type": "fm.plyr.track",
  "media": {
    "uri": "at://did:.../fm.plyr.media.artifact/...",
    "cid": "b..."
  },
  "title": "...",
  "artist": "...",
  "createdAt": "..."
}
```

or a new `fm.plyr.recording` / `fm.plyr.release.track` record supersedes the current track shape and keeps `fm.plyr.track` as the legacy compatibility record.

### We should not wait for finalized ecosystem lexicons

- The current architecture already behaves like a media service sidecar: R2 object storage, DB metadata/indexing, transcoder preparation, CDN delivery (`docs/internal/research/2026-01-29-atproto-media-service-patterns.md:31`).
- To lead rather than wait, plyr.fm can define a narrow, DASL-compatible artifact record now and later alias or migrate it to a common namespace.
- The least regrettable first step is additive: keep `fm.plyr.track` working, add artifact records for new uploads, and index them locally.

## recommended next steps

1. Design `fm.plyr.media.artifact` and possibly `fm.plyr.media.manifest` lexicons.
   - Use full hashes / DASL CIDs, not truncated `file_id`.
   - Allow multiple roles: source, playback, segment manifest, presentation.
   - Use strongRefs for derivation edges.

2. Implement full-hash metadata in storage before changing playback.
   - Store full SHA-256, byte length, mime/container, codec, role, and derivation source.
   - Keep the 16-char `file_id` as a storage compatibility key for now.

3. Prototype a derived segmented artifact behind a feature flag.
   - Start with normal browser-compatible HLS/fMP4 if MUXL tooling is not ready.
   - Shape the record as if MUXL segments are coming: manifest + segment refs + hashes, not just `streamUrl`.

4. Add service-signed provenance first.
   - Sign "plyr.fm derived artifact B from source artifact A with pipeline version X".
   - Do not claim artist authorship until there is a clear user-controlled signing flow.

5. Revisit signer model for artist DIDs.
   - Options: OAuth-bound PDS record attestation, app-password-like signing key, delegated capability, or future ATProto signing primitive.
   - Avoid asking users to export account private keys.

## code references

- `lexicons/track.json:11` - current required `fm.plyr.track` fields.
- `lexicons/track.json:25` - current `audioUrl` field.
- `lexicons/track.json:75` - current `audioBlob` field.
- `docs/public/lexicons/overview.md:62` - current canonical blob / fallback URL semantics.
- `backend/src/backend/storage/r2.py:155` - current truncated content hash `file_id`.
- `backend/src/backend/utilities/hashing.py:11` - chunked SHA-256 helper.
- `backend/src/backend/models/track.py:30` - playable `file_id`.
- `backend/src/backend/models/track.py:34` - preserved original file ID.
- `backend/src/backend/api/tracks/uploads.py:595` - upload storage phase decides playable rendition.
- `backend/src/backend/api/tracks/audio_optimize.py:1` - deferred MP3 optimization from lossless source.
- `backend/src/backend/api/audio.py:35` - audio endpoint still resolves by one file ID.
- `frontend/src/lib/audio-source.ts:50` - frontend picks one file ID for a track.
- `frontend/src/lib/components/player/Player.svelte:388` - player attaches a single resolved URL to the audio element.
- `services/moderation/src/labels.rs:102` - existing secp256k1 signing precedent.

## open questions

- Should the media artifact record live under `fm.plyr.media.*`, a future shared DASL namespace, or both?
- Is the primary public object a segment manifest, a single flat MP4 presentation, or both?
- How should ATProto clients discover the best playback rendition: explicit preference order, client capability matching, or AppView negotiation?
- How do gated/supporter-only tracks reference encrypted segments without leaking direct URLs?
- What exact S2PA claim should plyr.fm sign first: upload receipt, derivation receipt, rights metadata, or all of them as separate attestations?
- Can artist signing be done via PDS-hosted records rather than embedded S2PA signatures until user-controlled media signing is practical?

## sources

- MUXL: https://dasl.ing/muxl.html
- S2PA: https://dasl.ing/s2pa.html
- DASL CIDs: https://dasl.ing/cid.html
- BDASL: https://dasl.ing/bdasl.html
- DRISL: https://dasl.ing/drisl.html
- Related issues: #1457, #614, #146
