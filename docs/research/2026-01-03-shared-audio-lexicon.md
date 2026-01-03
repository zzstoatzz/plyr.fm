# shared audio lexicon adoption

> **status**: design phase
> **issue**: [#705](https://github.com/zzstoatzz/plyr.fm/issues/705)
> **date**: 2026-01-03

## context

[ooo.audio](https://ooo.audio) defines a shared lexicon (`audio.ooo.track`) for audio content on ATProto. the goal: tracks uploaded to plyr.fm, whalefall, or any future ATProto audio app are discoverable and playable everywhere because everyone writes to the same base schema.

this follows the [standard.site](https://standard.site) pattern for long-form publishing, where multiple platforms (Offprint, Leaflet, pckt.blog) adopted `site.standard.document` as a shared schema.

## the case for adoption

**without shared lexicons:**
- each app defines its own schema (`fm.plyr.track`, `fm.whalefall.track`, etc.)
- indexers and clients must support every variation
- switching apps means losing your content or complex migrations
- the ATProto ecosystem fragments like RSS reader variations

**with shared lexicons:**
- one schema for discovery, any app can read it
- content is truly portable - your tracks live in your PDS, playable anywhere
- indexers and tooling build once, work everywhere
- platform-specific features live as extensions, not forks

## schema comparison

| field | `audio.ooo.track` | `fm.plyr.track` | notes |
|-------|-------------------|-----------------|-------|
| title | required (128 graphemes) | required (256 chars) | align to shared |
| audio URL | `uri` (required) | `audioUrl` (required) | rename |
| format | `mimeType` (required) | `fileType` (required) | audio/mpeg vs mp3 |
| duration | milliseconds | seconds | shared uses ms |
| artwork | blob (1MB max) | `imageUrl` (URL) | blob is more portable |
| createdAt | required | required | same |
| description | optional (300 graphemes) | not present | add support |
| artist | not in base | required | plyr extension |
| album | not in base | optional | plyr extension |
| features | not in base | optional | plyr extension |
| supportGate | not in base | optional | plyr extension |

## extension strategy

per [standard.site FAQ](https://standard.site):

> **Can I extend the lexicons?**
> Yes. Additional properties pass through validation. Platform-specific features can live alongside the standard fields. The schema defines a shared baseline, not a constraint.

plyr.fm writes `audio.ooo.track` records with additional fields:

```json
{
  "$type": "audio.ooo.track",
  "title": "friend of the devil",
  "uri": "https://cdn.plyr.fm/audio/abc123.m4a",
  "mimeType": "audio/mp4",
  "duration": 89000,
  "createdAt": "2026-01-02T01:33:57.358Z",

  "artist": "nate",
  "album": "covers",
  "supportGate": { "type": "any" },
  "features": [{ "did": "did:plc:...", "handle": "guest.bsky.social" }]
}
```

other apps see the base fields; plyr.fm reads everything.

## environment isolation

**problem**: shared lexicons are environment-agnostic. we can't have `audio.ooo.dev.track` polluting the shared namespace with test data.

**solution**: plyr-owned sandbox namespaces that mirror the shared structure:

| environment | track collection |
|-------------|------------------|
| production  | `audio.ooo.track` |
| staging     | `fm.plyr.stg.audio.track` |
| development | `fm.plyr.dev.audio.track` |

the `fm.plyr.{env}.audio.` prefix signals "this is our local mirror of the shared schema" while staying firmly in plyr's namespace.

## config changes

new settings in `AtprotoSettings`:

```python
shared_track_collection: str | None = Field(
    default=None,
    validation_alias="SHARED_TRACK_COLLECTION",
    description="Collection for shared audio track records (audio.ooo.track).",
)

use_shared_track_writes: bool = Field(
    default=False,
    validation_alias="USE_SHARED_TRACK_WRITES",
    description="When true, write new tracks to shared collection.",
)
```

deploy config:

```bash
# production
SHARED_TRACK_COLLECTION=audio.ooo.track
USE_SHARED_TRACK_WRITES=true

# staging
SHARED_TRACK_COLLECTION=fm.plyr.stg.audio.track
USE_SHARED_TRACK_WRITES=true

# development
SHARED_TRACK_COLLECTION=fm.plyr.dev.audio.track
USE_SHARED_TRACK_WRITES=true
```

OAuth scopes automatically include the shared collection when configured.

## implementation phases

### phase 1: config + schema mapping (this PR)

- [x] add `shared_track_collection` and `use_shared_track_writes` config
- [x] update OAuth scopes to request shared collection permission
- [ ] define schema mapping functions (fm.plyr.track <-> audio.ooo.track)
- [ ] add `audio.ooo.track` lexicon JSON to `/lexicons/`

### phase 2: write path

- [ ] update track upload to write to `effective_track_collection`
- [ ] map plyr fields to shared schema + extensions
- [ ] handle mimeType conversion (mp3 -> audio/mpeg, etc.)
- [ ] convert duration seconds -> milliseconds

### phase 3: read path

- [ ] update sync logic to read from both collections
- [ ] map shared schema back to plyr internal model
- [ ] update indexing to handle both record types

### phase 4: migration (optional)

- [ ] script to copy existing `fm.plyr.track` records to shared collection
- [ ] or just dual-read indefinitely

## open questions

1. **artwork blob vs URL**: shared schema uses blobs, plyr uses URLs. do we:
   - upload artwork as blob (more portable, requires blob handling)
   - keep URL as extension field (less portable, simpler)
   - both (blob for standard, URL as extension for CDN optimization)

2. **duration precision**: shared uses milliseconds, plyr uses seconds. straightforward conversion, but existing records have seconds - do we backfill?

3. **mimeType mapping**: need to map file extensions to MIME types:
   - mp3 -> audio/mpeg
   - m4a -> audio/mp4
   - flac -> audio/flac
   - wav -> audio/wav
   - ogg -> audio/ogg

4. **backwards compatibility**: how long do we maintain dual-read from `fm.plyr.track`? forever? until all records migrated?

## references

- [ooo.audio](https://ooo.audio) - shared audio lexicon
- [standard.site](https://standard.site) - shared publishing lexicon pattern
- [issue #705](https://github.com/zzstoatzz/plyr.fm/issues/705) - adoption discussion
- [ATProto lexicon spec](https://atproto.com/specs/lexicon)
