# research: moderation architecture overhaul

**date**: 2025-12-20
**question**: how should plyr.fm evolve its moderation architecture based on Roost Osprey and Bluesky Ozone patterns?

## summary

plyr.fm has a functional but minimal moderation system: AuDD copyright scanning + ATProto label emission. Osprey (Roost) provides a powerful rules engine for complex detection patterns, while Ozone (Bluesky) offers a mature moderation workflow UI. The recommendation is a phased approach: first consolidate the existing Rust labeler with Python moderation logic, then selectively adopt patterns from both projects.

## current plyr.fm architecture

### components

| layer | location | purpose |
|-------|----------|---------|
| moderation service | `services/moderation/` (Rust) | AuDD scanning, label signing, XRPC endpoints |
| backend integration | `backend/src/backend/_internal/moderation.py` | orchestrates scans, stores results, emits labels |
| moderation client | `backend/src/backend/_internal/moderation_client.py` | HTTP client with redis caching |
| background tasks | `backend/src/backend/_internal/background_tasks.py` | `sync_copyright_resolutions()` perpetual task |
| frontend | `frontend/src/lib/moderation.svelte.ts` | sensitive image state management |

### data flow

```
upload → schedule_copyright_scan() → docket task
                    ↓
         moderation service /scan
                    ↓
              AuDD API
                    ↓
         store in copyright_scans table
                    ↓
         if flagged → emit_label() → labels table (signed)
                    ↓
         frontend checks labels via redis-cached API
```

### limitations

1. **single detection type**: only copyright via AuDD fingerprinting
2. **no rules engine**: hard-coded threshold (score >= X = flagged)
3. **manual admin ui**: htmx-based but limited (no queues, no workflow states)
4. **split architecture**: sensitive images in backend, copyright labels in moderation service
5. **no audit trail**: resolutions tracked but no event sourcing

## osprey architecture (roost)

### key concepts

Osprey is a **rules engine** for real-time event processing, not just a labeler.

**core components:**

1. **SML rules language** - declarative Python subset for signal combining
   ```python
   Spam_Rule = Rule(
       when_all=[
           HasLabel(entity=UserId, label='new_account'),
           PostFrequency(user=UserId, window=TimeDelta(hours=1)) > 10,
       ],
       description="High-frequency posting from new account"
   )
   ```

2. **UDF plugin system** - extensible signals and effects
   ```python
   @hookimpl_osprey
   def register_udfs() -> Sequence[Type[UDFBase]]:
       return [TextContains, AudioFingerprint, BanUser]
   ```

3. **stateful labels** - labels persist and are queryable in future rules
4. **batched async execution** - gevent greenlets with automatic batching
5. **output sinks** - kafka, postgres, webhooks for result distribution

### what osprey provides that plyr.fm lacks

| capability | plyr.fm | osprey |
|------------|---------|--------|
| multi-signal rules | no | yes (combine 10+ signals) |
| label persistence | yes (basic) | yes (with TTL, query) |
| rule composition | no | yes (import, require) |
| batched execution | no | yes (auto-batching UDFs) |
| investigation UI | minimal | full query interface |
| operator visibility | limited | full rule tracing |

### adoption considerations

**pros:**
- could replace hard-coded copyright threshold with configurable rules
- would enable combining signals (e.g., new account + flagged audio + no bio)
- plugin architecture aligns with plyr.fm's need for multiple moderation types

**cons:**
- heavy infrastructure (kafka, druid, postgres, redis)
- python-based (plyr.fm moderation service is Rust)
- overkill for current scale

## ozone architecture (bluesky)

### key concepts

Ozone is a **moderation workflow UI** with queue management and team coordination.

**review workflow:**
```
report received → reviewOpen → (escalate?) → reviewClosed
                      ↓
              muted / appealed / takendown
```

**action types:**
- acknowledge, label, tag, mute, comment
- escalate, appeal, reverse takedown
- email (template-based)
- takedown (PDS or AppView target)
- strike (graduated enforcement)

### patterns applicable to plyr.fm

1. **queue-based review** - flagged content enters queue, moderators triage
2. **event-sourced audit trail** - every action is immutable event
3. **internal tags** - team metadata not exposed to users
4. **policy-linked actions** - associate decisions with documented policies
5. **bulk CSV import/export** - batch artist verification, label claims
6. **graduated enforcement (strikes)** - automatic actions at thresholds
7. **email templates** - DMCA notices, policy violations

### recent ozone updates (dec 2025)

from commits:
- `ae7c30b`: default to appview takedowns
- `858b6dc`: fix bulk tag operations
- `8a1f333`: age assurance events with access property

haley's team focus: making takedowns and policy association more robust.

## recommendation: phased approach

### phase 1: consolidate (week 1)

**goal**: unify moderation into single service, adopt patterns

1. **move sensitive images to moderation service** (issue #544)
   - add `sensitive_images` table to moderation postgres
   - add `/sensitive-images` endpoint
   - update frontend to fetch from moderation service

2. **add event sourcing for audit trail**
   - new `moderation_events` table: action, subject, actor, timestamp, details
   - log: scans, label emissions, resolutions, sensitive flags

3. **implement negation labels on track deletion** (issue #571)
   - emit `neg: true` when tracks with labels are deleted
   - cleaner label state

### phase 2: rules engine (week 2)

**goal**: replace hard-coded thresholds with configurable rules

1. **add rule configuration** (can be simple JSON/YAML to start)
   ```yaml
   rules:
     copyright_violation:
       when:
         - audd_score >= 85
       actions:
         - emit_label: copyright-violation

     suspicious_upload:
       when:
         - audd_score >= 60
         - account_age_days < 7
       actions:
         - emit_label: needs-review
   ```

2. **extract UDF-like abstractions** for signals:
   - `AuddScore(track_id)`
   - `AccountAge(did)`
   - `HasPreviousFlag(did)`

3. **add admin review queue** (borrowing from ozone patterns)
   - list items by state: pending, reviewed, dismissed
   - bulk actions

### phase 3: polish (week 3 if time)

**goal**: robustness and UX

1. **graduated enforcement** - track repeat offenders, auto-escalate
2. **policy association** - link decisions to documented policies
3. **email templates** - DMCA notices, takedown confirmations

## code references

current moderation code:
- `services/moderation/src/main.rs:70-101` - router setup
- `services/moderation/src/db.rs` - label storage
- `services/moderation/src/labels.rs` - secp256k1 signing
- `backend/src/backend/_internal/moderation.py` - scan orchestration
- `backend/src/backend/_internal/moderation_client.py` - HTTP client
- `backend/src/backend/_internal/background_tasks.py:180-220` - sync task

osprey patterns to adopt:
- `osprey_worker/src/osprey/engine/executor/executor.py` - batched execution model
- `osprey_worker/src/osprey/worker/adaptor/plugin_manager.py` - plugin hooks
- `example_plugins/register_plugins.py` - UDF registration pattern

ozone patterns to adopt:
- event-sourced moderation actions
- review state machine (open → escalated → closed)
- bulk workspace operations

## open questions

1. **should we rewrite moderation service in python?**
   - pro: unified stack, easier to add rules engine
   - con: rust is working, label signing is performance-sensitive

2. **how much of osprey do we actually need?**
   - full osprey: kafka + druid + postgres + complex infra
   - minimal: just the rule evaluation pattern with simple config

3. **do we need real-time event processing?**
   - current: batch via docket (5-min perpetual task)
   - osprey: real-time kafka streams
   - likely overkill for plyr.fm scale

4. **should admin UI move to moderation service?**
   - currently: htmx in rust service
   - alternative: next.js like ozone, or svelte in frontend

## external references

- [Roost Osprey](https://github.com/roostorg/osprey) - rules engine
- [Bluesky Ozone](https://github.com/bluesky-social/ozone) - moderation UI
- [Roost roadmap](https://github.com/roostorg/community/blob/main/roadmap.md)
- [ATProto Label Spec](https://atproto.com/specs/label)
