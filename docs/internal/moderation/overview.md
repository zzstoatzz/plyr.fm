---
title: "moderation on plyr.fm"
---

## philosophy

plyr.fm's approach to moderation is inspired by [Bluesky's stackable moderation architecture](https://bsky.social/about/blog/03-12-2024-stackable-moderation). the core insight: **moderation is information, not enforcement**.

rather than building systems that automatically remove content, we build systems that produce *signals* about content. what happens with those signals is a separate decision — made by humans, configurable per context, and transparent to all parties.

## why this matters for an audio platform

audio platforms face unique moderation challenges:

1. **copyright is murky** — fair use, samples, remixes, covers all exist in gray areas
2. **false positives are costly** — removing an original track because it "sounds like" something else destroys trust
3. **enforcement has legal weight** — DMCA takedowns have real consequences for creators
4. **context matters** — a DJ mix is different from a stolen track

a system that auto-deletes on detection would be legally risky, user-hostile, and technically brittle. instead, we produce signals and defer enforcement to humans who can apply judgment.

## architecture

### current flow (as of july 2026)

```
track upload completes
        │
        ▼
┌─────────────────┐     ┌───────────────────┐     ┌─────────────┐
│  plyr backend   │────▶│  moderation svc   │────▶│   AuDD API  │
│  (FastAPI)      │     │  (Rust, Fly.io)   │     │             │
└─────────────────┘     └───────────────────┘     └─────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌───────────────────┐
│ copyright_scans │     │ is_flagged?       │
│ (Neon postgres) │     │ (dominant_match   │
└─────────────────┘     │  >= threshold)    │
        │               └───────────────────┘
        │                       │ yes
        ▼                       ▼
┌─────────────────┐     ┌───────────────────┐
│ DM admin via    │     │ admin reviews in  │
│ ATProto notif   │     │ htmx dashboard    │
└─────────────────┘     └───────┬───────────┘
                                │ manual action
                                ▼
                        ┌───────────────────┐
                        │ emit/negate label │
                        │ via POST          │
                        │ /emit-label       │
                        └───────────────────┘
```

### components

| component | location | what it does |
|-----------|----------|--------------|
| **plyr backend** | `backend/src/backend/_internal/moderation.py` | triggers scans on upload, stores results, DMs admin if flagged |
| **moderation service** | `services/moderation/` (Rust, Fly.io) | AuDD scanning, ATProto label signing/emission, admin dashboard |
| **admin dashboard** | `services/moderation/src/admin.rs` | htmx UI for reviewing flags, resolving false positives |
| **label cache** | `backend/_internal/clients/moderation.py` | backend caches active labels to check track visibility |
| **content policy** | `backend/_internal/content_labels.py` | maps interoperable label values to viewer discovery and playback behavior |
| **sensitive images** | `services/moderation/src/handlers.rs` | Claude-powered image moderation for cover art |

### what doesn't happen automatically

labels are **never auto-emitted** today. a copyright scan produces a flag, the
admin gets a DM, and the admin manually decides whether to emit a
`copyright-violation` label or resolve it as a false positive. Adult-audio labels
can come from either a creator notice in the track record or an operator review
and signed label emission.

creator self-labels are indexed directly from the canonical PDS record and stay
separate from signed labeler assertions. The policy layer evaluates their union;
it does not promote creator values into operator-signed labels.

### Osprey rules engine (PR #958, not yet merged)

[Osprey](https://github.com/roostorg/osprey) is a declarative rules engine that would add automatic label emission for high-confidence matches:

```
backend (scan completes) → Redis stream → Osprey worker → POST /emit-label
```

Osprey reads from the existing Redis instance (same one used for docket), evaluates SML rules against scan data, and calls the Rust service's `/emit-label` endpoint. the existing DM + admin dashboard flow remains unchanged.

see PR #958 for current status.

## label values

| val | meaning | who emits it |
|-----|---------|-------------|
| `copyright-violation` | high-confidence copyright match | admin (manual) or Osprey (future) |
| `copyright-review` | moderate-confidence, needs review | Osprey (future) |
| `sexual` | adult audio with sexual discussion, sounds, or themes | creator and/or operator |
| `porn` | audio whose primary purpose is pornographic content | creator and/or operator |

`sexual` and `porn` are global ATProto values, not plyr.fm-specific taxonomy.
Both map to the adult-audio preference and default-hide policy. Negation
(`neg: true`) revokes the latest active label state without deleting history.

### assertion versus enforcement

creators own self-label assertions in their track records, the moderation
service owns signed operator assertions, and the backend owns policy:

1. project active values onto `tracks.operator_labels` (`sync_operator_labels`,
   refreshed immediately by the `subscribeLabels` consumer)
2. filter adult-labeled tracks from default discovery and collection surfaces
   unless the viewer opted in or owns the track
3. filter copyright-labeled tracks from those surfaces for everyone — no
   preference, no owner exemption
4. always exclude both from shared radio

**labels do not gate audio bytes.** Neither family does. The adult gate was
removed because it read as age verification without being one, and copyright
de-lists rather than blocks because a fingerprint match is not a finding. That
also removed a strict labeler read, and its `503`, from every audio request.

see [label policy](label-policy.md) for who decides what, and why the two
families differ.

## key technical details

### AuDD and accurate_offsets

we use AuDD's enterprise API with `accurate_offsets=1`, which scans audio in segments and returns groups of matches per offset. this mode does **not** return per-match confidence scores — `highest_score` is always 0.

the meaningful signal is **dominant match percentage**: what fraction of audio segments match the same song. if 85% of segments match "Song X", that's a strong signal. if segments match 10 different songs at 10% each, that's noise.

### flagging threshold

the Rust service flags a track when `dominant_match_pct >= MODERATION_COPYRIGHT_SCORE_THRESHOLD` (default: 30%).

the env var name mismatch that once made this silently 30% is fixed —
`fly.toml` and `config.rs` both use `MODERATION_COPYRIGHT_SCORE_THRESHOLD`, so
production runs at the intended 70%.

a mix of several copyrighted songs trips a separate check
(`MODERATION_COPYRIGHT_MIX_SONG_THRESHOLD`, #1689): no single song dominates a
DJ mix, so the per-song percentage stays low while the count of sustained
distinct songs is the signal.

### the review queue

the dashboard's primary tab reads the **moderation event log**, not labels. it
previously read active labels, which meant scan flags were structurally
invisible: post-#703 a scan never emits a label, so the queue rendered empty
while flagged tracks accumulated. see [event log](event-log.md).

each queue item embeds `plyr.fm/embed/track/{id}` so a copyright call is made by
listening. Decisions — acknowledge, allow anyway, keep de-listed — post back to
the event log and require an `acting as` handle.

### decisions and overrides

negating a label says the assertion was wrong. An **override** says the
assertion stands and we are surfacing the track anyway, which is the usual
outcome for a cover or a remix. Those are different statements and both are
recorded.

### notifications

when a scan flags a track the backend DMs the operator
(`notification_service.send_copyright_flag_notification`) and opens a review
item. **uploaders are never notified automatically** — and any future
notification must fire on new events only, never on a backfill.

decisions that change what the public can see are published to
[@moderation.plyr.fm](https://bsky.app/profile/moderation.plyr.fm); flags and
reports are not. see [label policy](label-policy.md).

## related documentation

- [copyright detection](copyright-detection.md) — scan flow, data model, interpreting results
- [ATProto labeler](atproto-labeler.md) — label signing, XRPC endpoints, deployment
- [sensitive content](sensitive-content.md) — image moderation with Claude
- [sensitive-audio runbook](../runbooks/moderating-sensitive-audio.md) — operator emission, cache invalidation, and verification
