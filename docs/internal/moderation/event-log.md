---
title: "moderation event log"
---

`moderation_events` in the `plyr-moderation` Neon project. Append-only; state is
derived from the latest relevant event per subject, the same way label state is.

## why it exists

labels record what we *assert* about content. Nothing recorded what we *did*, or
who did it. That gap had four consequences that looked like four separate
missing features:

- **no override.** The only lever against a false positive was negating the
  label, which forces you to claim the assertion was wrong in order to change
  the behaviour. "The match is real, it's a cover, surface it anyway" had
  nowhere to live.
- **no queue.** `copyright_scans.is_flagged` lives in the *backend* database,
  which the moderation dashboard cannot read. Flags were raised into a queue
  nobody could see — which is most of why thirteen tracks sat unreviewed.
- **no audit trail.** Every action was anonymous.
- **nothing for an agent to propose.** A reviewable proposed action needs
  somewhere to be proposed.

one table covers all four.

## shape

```
moderation_events
  id                BIGSERIAL, monotonic — also the publisher cursor
  subject_uri       AT URI (the key; reports must resolve one to enqueue)
  subject_track_id  plyr track id when known
  action            see below
  actor             who — required, rejected when blank
  reason / notes
  created_at
```

## actions

| action | opens review | closes review | published |
|---|---|---|---|
| `flagged_by_scan` | ✅ | | |
| `reported` | ✅ | | |
| `label_applied` | | | ✅ |
| `label_negated` | | | ✅ |
| `acknowledged` | | ✅ | |
| `override_allow` | | ✅ | ✅ |
| `override_exclude` | | ✅ | ✅ |
| `override_clear` | | | |
| `takedown` | | ✅ | ✅ |

**emitting a label neither opens nor closes review.** Labelling a track states
what we assert; it is not the same as deciding you are finished with it.
Collapsing those two is how an empty queue came to mean "no work".

`override_clear` withdraws a previous decision and leaves the subject wherever
it was.

## derived state

**queue** — subjects whose most recent opening event has no closing event after
it. Re-opening falls out for free: a fresh report on a previously acknowledged
track has a higher id than the acknowledgement, so it surfaces again.

**overrides** — the latest `override_*` per subject wins. Projected onto
`tracks.moderation_override` by `sync_operator_labels` and read by
`discovery_visible_clause`.

## attribution is not authentication

`actor` is required on every write, but the service still trusts a single shared
`MODERATION_AUTH_TOKEN`. So this records a *claim* about who acted, only as good
as that key.

that is deliberate and worth stating precisely: it is the difference between an
audit trail and a pile of anonymous mutations, and it is the prerequisite for
telling a human reviewer, a second human, and an agent apart. **Real per-actor
authentication is the next foundational step, and it is what actually gates
letting an agent act rather than propose.**

## endpoints

service-to-service, on `/internal` (never aliased under `/admin` — those aliases
exist only for routes predating #1691):

- `POST /internal/events` — the backend records scan flags
- `GET /internal/overrides` — for the projection
- `GET /internal/events-since?after_id=&limit=` — publisher cursor walk
- `GET /internal/events-head` — start a cursor at "now" instead of replaying

operator surface:

- `GET /admin/queue`
- `POST /admin/events`
- `POST /admin/subject-events` — full history for one subject

## transparency publishing

`publish_moderation_decisions` (backend, every 2 min) walks the log from a redis
cursor and posts publishable decisions to
[@moderation.plyr.fm](https://bsky.app/profile/moderation.plyr.fm). It lives in
the backend because the Bluesky session already does, and reading the log on a
timer keeps the dependency pointing one way.

two properties matter more than throughput:

- **it cannot backfill.** On first run the cursor initialises to the log's head.
  Announcing decisions from months ago because a publisher shipped today is the
  same mistake as DMing uploaders about old flags.
- **it is off unless enabled.** `NOTIFY_PUBLISH_MODERATION_DECISIONS`, set on
  `relay-api` only — staging shares the Bluesky account. When off the task still
  runs and logs each rendered post, which is how the pipeline gets verified
  before anything reaches the timeline.

a failed post stops the batch rather than advancing past an announcement that
never happened. Posts carry `app.bsky.richtext.facet` link facets; a URL in post
text is not a link without one.
