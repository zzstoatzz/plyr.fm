---
title: "glossary"
description: "key terms used in plyr.fm and the AT Protocol"
---

plyr.fm-specific terms and ATProto concepts you'll encounter in the docs. for the full protocol glossary, see [atproto.com/guides/glossary](https://atproto.com/guides/glossary).

## ATProto concepts

### AppView

an application-level service that indexes and serves data from across the ATProto network. plyr.fm acts as an AppView for audio — it reads track records from user PDSes and presents them as a streaming platform. Bluesky is the AppView for social networking.

### collection

a named group of records in a user's data repo, identified by an [NSID](#nsid). plyr.fm uses collections like `fm.plyr.track`, `fm.plyr.like`, and `fm.plyr.list`. each collection holds records of a single type.

### DID

**Decentralized Identifier**. a persistent, globally unique identifier for an account (e.g. `did:plc:abc123`). unlike handles, DIDs don't change when you switch PDS providers or update your domain. plyr.fm uses DIDs internally to identify artists and users.

see: [atproto.com/specs/did](https://atproto.com/specs/did)

### handle (atproto handle)

a human-readable identifier for an atproto account, formatted as a domain name (e.g. `artist.bsky.social` or `yourname.com`). sometimes called an [internet handle](https://internethandle.org). handles can change — DIDs are the stable identifier underneath.

### Jetstream

a real-time event stream that broadcasts all record changes across the ATProto network. plyr.fm subscribes to Jetstream to detect tracks, likes, and other records created outside its own interface (e.g. from another ATProto client). see [docs.bsky.app/blog/jetstream](https://docs.bsky.app/blog/jetstream).

### lexicon

ATProto's schema system for defining record types and API methods. each lexicon has an [NSID](#nsid) and specifies the shape of a record type (required fields, types, constraints). plyr.fm's lexicons define what a track, like, comment, etc. look like. see [lexicons overview](/lexicons/overview/).

see: [atproto.com/guides/lexicon](https://atproto.com/guides/lexicon)

### NSID

**Namespace Identifier**. a reverse-DNS-format string that uniquely identifies a lexicon, collection, or API method (e.g. `fm.plyr.track`). the namespace authority (`fm.plyr`) maps to the domain that controls the schema (`plyr.fm`).

plyr.fm's namespaces are environment-aware: `fm.plyr` (production), `fm.plyr.stg` (staging), `fm.plyr.dev` (development).

### PDS

**Personal Data Server**. the server that stores your ATProto data repo — your records, blobs (files), and identity information. when you upload a track on plyr.fm, the audio blob and track metadata record are stored on your PDS. you can self-host a PDS or use a provider like `bsky.social`.

see: [atproto.com/guides/self-hosting](https://atproto.com/guides/self-hosting)

### permission set

a bundle of OAuth scopes under a human-readable name. instead of seeing individual scope strings, users see something like "plyr.fm Audio Library". plyr.fm defines `fm.plyr.authFullApp` to cover all required permissions.

### record

a single data entry in a user's repo, belonging to a [collection](#collection). a track upload creates a record in the `fm.plyr.track` collection. records are JSON objects conforming to their [lexicon](#lexicon) schema. each record has a unique key (usually a [TID](#tid)).

### rkey

**Record Key**. the identifier for a specific record within a collection. plyr.fm uses [TIDs](#tid) as rkeys for most records, and `self` for singleton records like profiles.

### strongRef

a reference to a specific version of a record, consisting of a URI (`at://did/collection/rkey`) and a CID (content hash). used when one record points to another — e.g. a like references the track it's about.

### TID

**Timestamp Identifier**. a base32-encoded timestamp used as a record key. TIDs are generated client-side and sort chronologically. plyr.fm uses TIDs as rkeys for tracks, likes, comments, and lists.

## plyr.fm concepts

### developer token

an API authentication token generated at [plyr.fm/portal](https://plyr.fm/portal). tokens have their own OAuth credentials and don't expire when your browser session refreshes. used for scripts, bots, and integrations. see [auth guide](/developers/auth/).

### jam

a shared listening room where multiple users control playback together in real time. one participant's browser plays audio (the "output device") while everyone else is a remote control. state syncs via WebSocket + Redis Streams.

### mood search

semantic search powered by [CLAP](https://github.com/LAION-AI/CLAP) audio embeddings. instead of matching keywords, it understands descriptions like "rainy afternoon jazz" and finds tracks with similar audio characteristics. currently feature-flagged (`vibe-search`) — not available to all users.

### portal

the artist dashboard at [plyr.fm/portal](https://plyr.fm/portal). manage your tracks, albums, playlists, developer tokens, and account settings.

### supporter-gated content

tracks locked behind supporter status via [ATProtoFans](https://atprotofans.com). listeners who support the artist get access; everyone else sees a lock. currently a binary check — any support relationship unlocks all gated tracks.
