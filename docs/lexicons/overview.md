---
title: "plyr.fm lexicons"
description: "ATProto lexicon schemas powering plyr.fm"
---

> **note**: this is living documentation. the lexicon JSON definitions in `/lexicons/` are the source of truth.

## what are lexicons?

lexicons are ATProto's schema system for defining record types and API methods. each schema uses a **Namespace ID (NSID)** in reverse-DNS format (e.g., `fm.plyr.track`) to uniquely identify it across the network.

for background, see:
- [ATProto lexicon guide](https://atproto.com/guides/lexicon)
- [ATProto data model](https://atproto.com/guides/data-repos)

## our namespace

plyr.fm uses the `fm.plyr` namespace for all custom record types. this is environment-aware:

| environment | namespace |
|-------------|-----------|
| production  | `fm.plyr` |
| staging     | `fm.plyr.stg` |
| development | `fm.plyr.dev` |

plyr.fm defines its own lexicons for music-specific concepts (tracks, likes, comments, playlists) rather than reusing `app.bsky.*` equivalents — this keeps the schema independent and music-focused. we also write to `fm.teal.*` collections for [teal.fm](https://teal.fm) scrobble integration. at login, plyr.fm requests OAuth scopes for each collection it needs to write to (see [permission sets](#permission-sets) below).

## current lexicons

### fm.plyr.track

the core content record — an audio track uploaded by an artist.

```
key: tid (timestamp-based ID)
required: title, artist, fileType, createdAt
optional: audioUrl, audioBlob, album, duration, features, imageUrl, description, supportGate
note: at least one of audioUrl or audioBlob must be present
```

example record from the network:

```json
{
  "$type": "fm.plyr.track",
  "title": "plyr.fm update - February 27, 2026",
  "artist": "plyr.fm",
  "album": "2026",
  "audioUrl": "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/audio/ada9cadc63efd822.wav",
  "audioBlob": {
    "$type": "blob",
    "ref": { "$link": "bafkreifnvhfnyy7p3ara2gdyv6krztsd26luv2mi45j7hw3sreq7xjpd24" },
    "mimeType": "audio/vnd.wave",
    "size": 12760890
  },
  "fileType": "wav",
  "duration": 265,
  "createdAt": "2026-02-27T16:08:13.146107Z"
}
```

this was the first lexicon, established when the project began. tracks are stored in the user's PDS (Personal Data Server) and indexed by plyr.fm for discovery. when both `audioUrl` and `audioBlob` are present, the blob on the PDS is canonical and the URL is a CDN fallback.

### fm.plyr.like

engagement signal indicating a user liked a track.

```
key: tid
required: subject (strongRef to track), createdAt
```

example:

```json
{
  "$type": "fm.plyr.like",
  "subject": {
    "uri": "at://did:plc:vs3hnzq2daqbszxlysywzy54/fm.plyr.track/3lfvhszifvc2c",
    "cid": "bafyreig2aotx4pgpwqxotzm7i3vgyalrdfemsqr6ukdpmqrhfdvh2mcq5i"
  },
  "createdAt": "2026-01-15T10:30:00.000Z"
}
```

uses `com.atproto.repo.strongRef` to reference the target track by URI and CID, which is the standard ATProto pattern for cross-record references.

### fm.plyr.comment

timed comments anchored to playback positions, similar to SoundCloud.

```
key: tid
required: subject (strongRef to track), text, timestampMs, createdAt
optional: updatedAt
```

example:

```json
{
  "$type": "fm.plyr.comment",
  "subject": {
    "uri": "at://did:plc:vs3hnzq2daqbszxlysywzy54/fm.plyr.track/3lfvhszifvc2c",
    "cid": "bafyreig2aotx4pgpwqxotzm7i3vgyalrdfemsqr6ukdpmqrhfdvh2mcq5i"
  },
  "text": "this drop is unreal",
  "timestampMs": 45000,
  "createdAt": "2026-01-15T10:35:00.000Z"
}
```

the `timestampMs` field captures playback position when the comment was made, enabling "click to seek" functionality.

### fm.plyr.list

generic ordered collection for playlists, albums, and liked track lists.

```
key: tid
required: items (array of strongRefs), createdAt
optional: name, listType, updatedAt
```

example (a playlist with two tracks):

```json
{
  "$type": "fm.plyr.list",
  "name": "late night ambient",
  "listType": "playlist",
  "items": [
    {
      "subject": {
        "uri": "at://did:plc:vs3hnzq2daqbszxlysywzy54/fm.plyr.track/3lfvhszifvc2c",
        "cid": "bafyreig2aotx4pgpwqxotzm7i3vgyalrdfemsqr6ukdpmqrhfdvh2mcq5i"
      }
    },
    {
      "subject": {
        "uri": "at://did:plc:abc123/fm.plyr.track/3lgahszifvc4e",
        "cid": "bafyreih3bpqx4pgpwqxotzm7i3vgyalrdfemsqr6ukdpmqrhfdvh2mcq6j"
      }
    }
  ],
  "createdAt": "2026-01-20T18:00:00.000Z"
}
```

the `listType` field uses `knownValues` (an ATProto pattern for extensible enums) with current values: `album`, `playlist`, `liked`. validators won't reject unknown values, so the schema can evolve without breaking existing records.

### fm.plyr.actor.profile

artist profile metadata specific to plyr.fm.

```
key: literal:self (singleton - only one per user)
required: createdAt
optional: bio, avatar, updatedAt
```

example:

```json
{
  "$type": "fm.plyr.actor.profile",
  "bio": "making sounds in the pacific northwest",
  "createdAt": "2025-12-01T12:00:00.000Z",
  "updatedAt": "2026-02-15T09:30:00.000Z"
}
```

uses `literal:self` as the record key, meaning each user can only have one profile record. this is updated via `putRecord` with rkey="self".

## ATProto primitives we use

### record keys

- **tid**: timestamp-based IDs generated by the client. used for most records where multiple instances per user are expected (tracks, likes, comments, lists).
- **literal:self**: a fixed key for singleton records. used for profile where only one record per user should exist.

### strongRef

`com.atproto.repo.strongRef` is ATProto's standard way to reference another record:

```json
{
  "uri": "at://did:plc:xyz/fm.plyr.track/abc123",
  "cid": "bafyreig..."
}
```

the URI identifies the record; the CID is its content hash at a specific version. we use strongRefs in likes (referencing tracks), comments (referencing tracks), and lists (referencing any records).

### knownValues

rather than strict enums, ATProto uses `knownValues` for extensible value sets. our `fm.plyr.list.listType` field declares known values but validators won't reject unknown values - this allows the schema to evolve without breaking existing records.

## local indexing

ATProto records in user PDSes are the source of truth, but querying across PDSes is slow. we maintain local database tables that index records for efficient queries:

- `tracks` table indexes `fm.plyr.track` records
- `track_likes` table indexes `fm.plyr.like` records
- `track_comments` table indexes `fm.plyr.comment` records
- `playlists` table indexes `fm.plyr.list` records

the sync pattern: when a user logs in, we fetch their records from their PDS and update our local index. background jobs keep indexes fresh.

## permission sets

permission sets bundle OAuth permissions under human-readable titles. instead of users seeing "fm.plyr.track, fm.plyr.like, ..." they see "plyr.fm Music Library".

### fm.plyr.authFullApp

full access for the main web app - create/update/delete on all collections.

### enabling permission sets

set `ATPROTO_USE_PERMISSION_SETS=true` to use `include:fm.plyr.authFullApp` instead of granular scopes.

**requirement**: permission set lexicons must be published to `com.atproto.lexicon.schema` collection on the `plyr.fm` authority repo (`did:plc:vs3hnzq2daqbszxlysywzy54`).

permission sets are resolved by PDS servers at authorization time — the `include:` token is expanded into granular `repo:` scopes and never appears in the granted token. the authority namespace (e.g. `fm.plyr`) must match the requesting app's domain.

## login scopes

when you sign in to plyr.fm, the app requests OAuth scopes for the collections it needs to write to:

| scope | purpose |
|-------|---------|
| `repo:fm.plyr.feed.track` | create, update, delete tracks |
| `repo:fm.plyr.feed.like` | like and unlike tracks |
| `repo:fm.plyr.feed.comment` | timed comments |
| `repo:fm.plyr.graph.list` | playlists, albums, liked lists |
| `repo:fm.plyr.actor.profile` | artist profile |
| `repo:fm.teal.alpha.feed.play` | scrobbles to [teal.fm](https://teal.fm) |
| `repo:fm.teal.alpha.actor.status` | now-playing status |
| `blob:*/*` | upload audio and images |

scopes are requested at authorization time so your PDS knows exactly what plyr.fm is allowed to do.

## further reading

- [ATProto lexicon guide](https://atproto.com/guides/lexicon) — how lexicons work at the protocol level
- [ATProto lexicon style guide](https://atproto.com/guides/lexicon-style) — naming conventions and best practices
- [ATProto data model](https://atproto.com/guides/data-repos) — repos, records, and collections
- [ATProto glossary](https://atproto.com/guides/glossary) — canonical protocol terminology
- [plyr.fm glossary](/glossary/) — plyr.fm-specific terms and ATProto concepts in context
- [developer quickstart](/developers/quickstart/) — build an integration using these record types
