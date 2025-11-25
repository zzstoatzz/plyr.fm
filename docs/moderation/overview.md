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

## what we're building

### phase 1: detection infrastructure

- `copyright_flags` table storing scan results
- AuDD integration for music recognition
- background job triggered on upload
- admin endpoints to query flagged tracks

### phase 2: visibility

- admin dashboard for reviewing flags
- stats and trends
- manual rescan capability

### phase 3: user-facing (future)

- artists see flags on their own tracks
- dispute/appeal workflow
- notification on flag status change

## references

- [Bluesky's Stackable Approach to Moderation](https://bsky.social/about/blog/03-12-2024-stackable-moderation) - the blog post that inspired this architecture
- [Ozone GitHub](https://github.com/bluesky-social/ozone) - Bluesky's open-source moderation tool
- [AuDD API](https://docs.audd.io/) - music recognition service we use for copyright detection
- [AuDD Enterprise](https://docs.audd.io/enterprise/) - full-file scanning for copyright detection
- [AT Protocol](https://atproto.com/) - the protocol plyr.fm is built on

## related documentation

- [copyright-detection.md](./copyright-detection.md) - technical implementation details
