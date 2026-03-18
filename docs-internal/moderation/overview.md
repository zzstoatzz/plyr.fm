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

### current flow (as of march 2026)

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
| **sensitive images** | `services/moderation/src/handlers.rs` | Claude-powered image moderation for cover art |

### what doesn't happen automatically

labels are **never auto-emitted** today. the scan produces a flag, the admin gets a DM, and the admin manually decides whether to emit a `copyright-violation` label or resolve as false positive.

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

negation (`neg: true`) revokes a label — used when admin resolves a false positive.

## key technical details

### AuDD and accurate_offsets

we use AuDD's enterprise API with `accurate_offsets=1`, which scans audio in segments and returns groups of matches per offset. this mode does **not** return per-match confidence scores — `highest_score` is always 0.

the meaningful signal is **dominant match percentage**: what fraction of audio segments match the same song. if 85% of segments match "Song X", that's a strong signal. if segments match 10 different songs at 10% each, that's noise.

### flagging threshold

the Rust service flags a track when `dominant_match_pct >= MODERATION_COPYRIGHT_SCORE_THRESHOLD` (default: 30%).

**known issue**: `fly.toml` sets `MODERATION_SCORE_THRESHOLD=70` but the Rust code reads `MODERATION_COPYRIGHT_SCORE_THRESHOLD` — different env var name. the threshold has been the default 30% all along, not the intended 70%.

### admin dashboard

the admin dashboard lives on the Rust moderation service itself (option B from the original design discussion). it's an htmx UI at `/admin` that:

- lists flagged tracks with match details
- shows track title, artist, environment badge, match count
- allows resolving false positives (emits negation label)
- supports batch review workflows

### DM notifications

when a scan flags a track, the backend sends a DM to the admin via ATProto notifications (`notification_service.send_copyright_flag_notification`). this includes track title, artist handle, and match details. the DM is informational — it prompts the admin to review in the dashboard.

## related documentation

- [copyright detection](copyright-detection.md) — scan flow, data model, interpreting results
- [ATProto labeler](atproto-labeler.md) — label signing, XRPC endpoints, deployment
- [sensitive content](sensitive-content.md) — image moderation with Claude
