# ATProto media service patterns

research date: 2026-01-29
source: [discourse thread](https://discourse.atprotocol.community/t/media-pds-service/297) (18 posts, nov 2025 - jan 2026)
related issue: [#614](https://github.com/zzstoatzz/plyr.fm/issues/614)

## summary

the ATProto community is converging on a **sidecar media service** model: a separate service handles upload, transcoding, storage, and CDN delivery, while the PDS holds only a signed metadata record referencing the media. this is distinct from storing media blobs directly on the PDS.

## key design patterns

### signed media references

the proposed pattern is: upload media to a dedicated service, receive a signed record back, store that record in your PDS. the signature uses the media service's DID verification material, so relays and appviews can verify integrity without subscribing to the media service.

```json
{
  "$type": "example.media.lexicon.attachment",
  "server": "media-service.example",
  "creator": "did:<method>:<identifier>",
  "id": "some-unique-identifier",
  "signatures": { ... }
}
```

this record gets embedded in app-specific types (e.g., a track record references the attachment). the media service provides CDN URLs for playback via a `getLinks` query.

### layered architecture

multiple contributors (including Storacha, who operate large-scale IPFS storage) recommend building in distinct layers:

1. **object storage** — raw blob bytes, format-agnostic
2. **metadata and indexing** — what's stored where, content tags, search
3. **data preparation** — transcoding, sharding, hash generation
4. **content delivery** — CDN caching and bandwidth

each layer is an independent service. this matches our existing architecture: R2 for object storage, postgres for metadata, transcoder service for preparation, R2/CDN for delivery.

### resumable uploads

the [tus protocol](https://tus.io/) is proposed for large file uploads. this handles unstable connections and enables progress tracking for files too large for one-shot upload.

### baseline codecs

the thread suggests standardizing on baseline ingest formats (mp3, mp4, ogg) with HLS and MPEG-DASH for distribution. wav/flac ingest is discouraged due to size, though services can advertise additional format support.

## PDS blob limits

the PDS implementation distributed by Bluesky has a default **5MB blob size limit**. while configurable, most PDS hosts don't raise it. for plyr.fm, the vast majority of tracks (~98%) are under this limit, so PDS blob storage is viable for most uploads. the fallback to R2-only covers the exceptions.

## content protection approaches

one implementation (a catalog server for a music app) uses encrypted HLS segments served via XRPC endpoints, with dynamic m3u8 generation for key rotation. the interesting idea: HLS playlists could point to `at://` URIs instead of `https://` URLs, resolved via the [WG Private Data](https://github.com/bluesky-social/proposals/tree/main/private-data) work. this would put protected media references on-protocol.

this is relevant to our support-gated tracks, though the approach hasn't shipped publicly yet.

## capability-based auth

Storacha recommends [UCAN](https://ucan.xyz) (User Controlled Authorization Networks) as an authorization model. UCANs flip ownership so the storage service acts as a private locker rather than an authority over your data. Bluesky considered UCAN early in ATProto's development but it wasn't ready at the time.

## implications for plyr.fm

### what we're already doing right

- **R2 + CDN for delivery, PDS records for metadata** — this is the layered pattern the community is converging on
- **content-addressable storage** via SHA256 file IDs — aligns with the ecosystem's emphasis on verifiable blob integrity
- **separate transcoder service** — matches the "data preparation" layer
- **feature-flagged PDS blob uploads** (#833) — lets us experiment without committing to PDS as primary storage

### what to watch

- **`example.media.lexicon.*` namespace** — if this gets standardized, our track records should reference media via that format for interoperability
- **tus protocol adoption** — worth considering for large uploads if we support longer audio (DJ sets, podcasts)
- **encrypted HLS + XRPC** — if this ships and works, it could replace our current support gate implementation with a more protocol-native approach
- **UCAN** — potential long-term replacement for our auth model around media access

### what not to do

- don't invest heavily in making PDS the primary audio store — the community is moving away from PDS-as-media-host
- don't build a custom media service yet — the lexicons aren't standardized, and our R2 + CDN setup already handles our needs
- don't ignore the emerging patterns — keep the architecture compatible so we can adopt standards when they solidify
