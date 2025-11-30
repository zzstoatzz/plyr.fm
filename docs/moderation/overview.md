# moderation on plyr.fm

## philosophy

plyr.fm's approach to moderation is inspired by [Bluesky's stackable moderation architecture](https://bsky.social/about/blog/03-12-2024-stackable-moderation). the core insight: **moderation is information, not enforcement**.

rather than building systems that automatically remove content, we build systems that produce *signals* about content. what happens with those signals is a separate decision - made by humans, configurable per context, and transparent to all parties.

## why this matters for a music platform

music platforms face unique moderation challenges:

1. **copyright is murky** - fair use, samples, remixes, covers all exist in gray areas
2. **false positives are costly** - removing an original track because it "sounds like" something else destroys trust
3. **enforcement has legal weight** - DMCA takedowns have real consequences for creators
4. **context matters** - a DJ mix is different from a stolen track

a system that auto-deletes on detection would be:
- legally risky (wrongful takedowns)
- user-hostile (no recourse)
- technically brittle (AI isn't perfect)

instead, we produce signals and defer enforcement to humans who can apply judgment.

## the bluesky model

from [Bluesky's march 2024 blog post](https://bsky.social/about/blog/03-12-2024-stackable-moderation):

> "In designing these moderation services, Bluesky operated by three principles:
> 1. **Simple and Powerful**: Give users a pleasant default experience, with customization options under the hood
> 2. **User Choice**: Empower users and communities to develop their own moderation systems
> 3. **Openness**: Create an open system that increases trust in the governance of our digital spaces"

their system uses **labels** - metadata attached to content that different layers can interpret differently. a label might mean "hide this" in one context and "show with warning" in another.

[Ozone](https://github.com/bluesky-social/ozone), their open-source moderation tool, lets teams collaboratively review and label content. labels flow through the network, and clients decide how to render them.

## how plyr.fm applies these principles

### labels, not deletions

we scan uploaded tracks for potential copyright matches using [AuDD](https://audd.io/), a music recognition API. the scan produces:

- match confidence (0-100)
- matched song metadata (artist, title, ISRC)
- timestamp offsets (where in the file matches occur)

this data is stored as a **flag** - a label attached to the track. the flag doesn't delete anything. it's information that enables informed decisions.

### stackable architecture

copyright detection is one module in what could become a larger moderation ecosystem:

```
┌─────────────────────────────────────────────────┐
│              enforcement layer                  │
│    (admin review, user settings, policies)      │
└─────────────────────┬───────────────────────────┘
                      │ consumes signals
      ┌───────────────┼───────────────┐
      │               │               │
┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
│ copyright │   │  quality  │   │  reports  │
│  scanner  │   │  checker  │   │  service  │
└───────────┘   └───────────┘   └───────────┘
     AuDD         (future)        (future)
```

each service produces labels independently. enforcement is a separate concern.

### transparency and audit trails

every scan stores:
- full API response (for disputes)
- confidence scores (not just binary flags)
- timestamps (when scanned)
- scanner identifier (which system made the call)

if someone disputes a flag, we can show exactly what matched and why.

### sensible defaults, user choice later

current state:
- scans run automatically on upload
- results visible to admins only
- no automatic enforcement

future possibilities:
- artists see their own copyright status
- artists can contest flags
- configurable thresholds per user/context
- integration with ATProto labeling

## architecture

### current implementation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          upload flow                                     │
└─────────────────────────────────────────────────────────────────────────┘

    track upload
         │
         ▼
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  plyr backend   │─────▶│   moderation     │─────▶│     AuDD        │
│  (FastAPI)      │      │   service (Rust) │      │  (recognition)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
         │                        │
         │                        ▼
         │               ┌──────────────────┐
         │               │  if flagged:     │
         │               │  emit ATProto    │
         │               │  label           │
         │               └──────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌──────────────────┐
│  copyright_scans│      │  labels table    │
│  (postgres)     │      │  (postgres)      │
└─────────────────┘      └──────────────────┘
```

### components

1. **plyr backend** - triggers scans on upload, stores results in `copyright_scans`
2. **moderation service** - Rust service that wraps AuDD and emits ATProto labels
3. **ATProto labeler** - signed labels queryable via `com.atproto.label.queryLabels`

### ATProto label integration

labels are **signed data objects** (not repository records) that follow the AT Protocol labeling spec. when a track is flagged:

1. backend stores scan result in `copyright_scans` table
2. backend calls moderation service `/emit-label` endpoint
3. moderation service creates signed label with DID key
4. label stored in moderation service's `labels` table
5. label queryable via standard ATProto XRPC endpoints

this means other apps in the ATProto ecosystem can query our labels and apply their own enforcement policies.

```json
{
  "$type": "com.atproto.label.defs#label",
  "src": "did:plc:plyr-labeler",
  "uri": "at://did:plc:artist/fm.plyr.track/abc123",
  "val": "copyright-violation",
  "cts": "2025-11-30T12:00:00Z",
  "sig": "<secp256k1 signature>"
}
```

## what we're building

### phase 1: detection infrastructure ✅

- `copyright_scans` table storing scan results
- AuDD integration via moderation service
- background job triggered on upload
- ATProto label emission for flagged tracks

### phase 2: visibility (in progress)

- admin dashboard for reviewing flags
- stats and trends via Logfire
- label query endpoints

### phase 3: user-facing (future)

- artists see flags on their own tracks
- dispute/appeal workflow
- notification on flag status change
- label negation for resolved disputes

## admin UI considerations

the admin interface for managing moderation needs to live somewhere. three options:

### option A: main frontend (plyr.fm/admin)

**pros:**
- reuse existing auth (session cookies, artist roles)
- shared component library
- single deployment
- direct database access to both `tracks` and `copyright_scans`

**cons:**
- admin code bundled with user-facing app
- moderation logic spread across frontend + backend
- harder to open-source separately

### option B: separate UI on moderation service

**pros:**
- isolated deployment
- moderation service becomes self-contained
- could expose admin API alongside XRPC endpoints

**cons:**
- needs its own auth system
- Rust service now needs to serve HTML/JS (or add another service)
- queries `labels` table but needs to call backend API for track details

### option C: use Ozone

[Ozone](https://github.com/bluesky-social/ozone) is Bluesky's open-source moderation tool, designed for ATProto labelers.

**pros:**
- battle-tested, feature-complete
- team review workflows built-in
- ATProto-native (speaks labeler protocol)
- would work with our existing label endpoints

**cons:**
- designed for Bluesky's needs, not music-specific
- may need customization for copyright review workflow
- another service to deploy

### recommendation

**option A (main frontend)** is simplest for MVP:
- add `/admin` routes protected by role check
- query `copyright_scans` + `tracks` for review UI
- admin can emit negation labels via backend API
- later: extract to separate service if needed

the moderation service stays focused on scanning + labeling. the backend + frontend handle the human review workflow.

## references

- [Bluesky's Stackable Approach to Moderation](https://bsky.social/about/blog/03-12-2024-stackable-moderation) - the blog post that inspired this architecture
- [Ozone GitHub](https://github.com/bluesky-social/ozone) - Bluesky's open-source moderation tool
- [AuDD API](https://docs.audd.io/) - music recognition service we use for copyright detection
- [AT Protocol](https://atproto.com/) - the protocol plyr.fm is built on

## related documentation

- [copyright-detection.md](./copyright-detection.md) - scan flow and database schema
- [atproto-labeler.md](./atproto-labeler.md) - labeler service endpoints and signing
