---
title: "moderation admission and drift audit"
---

# Moderation admission and drift audit

October 16, 2026. The question is how plyr can discover records published by
other clients without treating prior login as a safety signal, overwhelming
media processing, or repeatedly rediscovering records intentionally left out.

## Verified state

- Production moderation runs on `plyr-moderation`, version 77, deployed October 1.
  Health reports `labeler_enabled: true`. Its identity is
  `did:plc:xnk7t5cvnnvzkmbf7wpss527`, handle `moderation.plyr.fm`; its DID document
  declares both `#atproto_label` and `#atproto_labeler`.
- The service declaration advertises `copyright-violation`, `sexual`, and
  `porn`. An independently checked historical label signature verifies against
  the declared public key. That does not prove all historical signatures valid.
- At the audit snapshot there were three active labels, all `sexual`, matching
  the production track projection by value. All three label CIDs differ from
  the indexed track CIDs: value equality conceals version-scope drift.
  Production telemetry shows regular
  five-minute reconciliation and a successful stream reconnection October 15.
- The moderation event log has 62 open review subjects, oldest July 25. These
  are workflow items, not 62 findings of abuse. October 2's cleanup left 33.
- Unknown artist DIDs are rejected by both the Jetstream consumer and track
  ingest. This dates to March 10's #1069/#1070. September's #2006 refreshed the
  known-DID cache sooner; October's #2121 repaired mirroring for known artists.
  Neither added network discovery. Login synchronization writes profile,
  album, and liked-list records outward; it does not backfill track records.

## Current record census

Read-only collection discovery returned 111 repositories from Lightrail and
129 from the Bluesky relay, a union of 130 DIDs. All 130 already have production
artist rows. Direct PDS enumeration succeeded for 125 repositories and read
1,222 records. Five repositories remained unresolved or unreadable; no successful
enumeration was truncated. This is index coverage, not a complete PDS census.

Compared with a production snapshot of 1,186 indexed AT URIs, 51 current records
across nine artists were absent. Nate explicitly excluded the 33 absent records
under `prefect.io` and nine under `zzstoatzzdevlog.bsky.social`. That is an
instruction about those 42 exact URIs, not a ban on either DID or future work.
The accompanying JSON captures the instruction; it is not deployed enforcement.
The remaining nine require investigation before any backfill. Absence alone
does not authorize restoration.

Sebastian's `center.for.cybernetic.beauty` resolved to
`did:plc:33k6yq7knpf5ecf532kdi5xy` on eurosky.social. At the snapshot it had no
production artist row and its current `fm.plyr.track` collection was empty.
The report fits the gate, but its earlier records could not be reproduced.
No audio or artwork was fetched, and no ingest, scans, or notifications ran.

## Policy boundaries

Signed labels carry assertions that other applications may interpret. They can
describe curation as well as abuse; their meaning alone does not implement an
admission policy. See the [label specification](https://atproto.com/specs/label).

The existing `override_exclude` means exclude an indexed track from LIST
surfaces. It leaves direct destinations and audio accessible, and the action
is eligible for transparency publishing. It cannot mean "do not index".

Use separate private `indexing_exclude` and `indexing_clear` events, with exact
AT record URI, authenticated operator attribution when available, reason, and
timestamp. The existing event log permits subjects without a track ID. Derive
the current indexing decision from the latest indexing event for that URI;
unrelated labels and acknowledgements must not erase it. Neither indexing action
should publish a label or transparency post, or implicitly close a review.

Check admission before create/update mutations and side effects. Deletes must
remain possible. A policy read failure is unavailable authority, not permission.
Excluding an already indexed record should surface a policy conflict; it must
not silently delete the track or media. Clearing an exclusion removes that
prohibition, not the other validation or moderation requirements.

## Reliability findings

1. `clients/moderation.py:get_active_labels_by_value` and
   `get_moderation_overrides` returned empty snapshots for missing credentials
   and missing response keys. `tasks/labels.py:sync_operator_labels` interprets
   empty as authoritative and can clear stored restrictions. The first repair
   rejects absent credentials and malformed snapshots before changing rows.
2. `services/moderation/src/xrpc.rs:handle_subscribe` replays only 1,000 rows,
   subscribes to broadcasts after replay, silently skips lag, and treats live
   broadcast order as sequence order. Committed labels can be missed. Broadcasts
   are also process-local. Use paginated durable reads with periodic catch-up;
   broadcasts should only wake a reader. Serialize sequence allocation and
   commit across database writers so an earlier uncommitted sequence cannot
   appear behind an advanced cursor.
3. The public subscription sends JSON text, confirmed against the live socket.
   The [event-stream specification](https://atproto.com/specs/event-stream)
   requires binary frames with CBOR header and payload. JSON signatures also
   serialize as integer arrays rather than the specified bytes representation.
   Migrate the backend consumer before changing the producer; verify with an
   independent client rather than testing only the two local implementations.
4. Active-label queries drop CID scope when projecting URI/value pairs. All
   three currently active labels have this mismatch in production; the label
   continues to affect a replacement version. The evidence does not establish
   whether its audio changed or the assertion remains substantively appropriate.
   Expiration is filtered
   in the service queries, but the backend projection can lag until reconciliation.
5. `db.rs:get_negated_labels` returns historical negations rather than latest
   state. The copyright resolution task can clear a current scan flag even
   after a subsequent positive label. No active positive currently has a
   historical negation, so the reapplication case is a code risk rather than a
   reproduced live state. Record-version scope needs review too.
6. Operator attribution is a supplied string behind a shared token, not
   per-actor authentication. This is insufficient for autonomous moderation
   decisions. Evidence collection can run without such decision authority.

## Ongoing checks

A bounded, metadata-only census should distinguish intentional exclusions,
unexplained unindexed records, indexed-policy conflicts, exclusions whose
subjects are now absent, and incomplete discovery. Record source, collection,
limits, observation times, and policy snapshot. Failed reads must never become
"deleted" or "no missing records". Re-read current records before admitting
them; archive replay is useful for incident history, not permission to restore.

Measure projection mismatch and last successful reconciliation, unresolved and
failed scans, unmirrored media, review age, queue growth, and admission backlog.
Keep uncertainty separate from a clean result. Only meaningful changes or failed
checks should draw operator attention; routine excluded records should not.

Opening ingestion to unknown artists additionally needs global and per-DID/PDS
budgets for metadata, download bytes, duration, vendor work, and retries. New
candidates need a hold before public surfaces and notifications. The current
create path sets `publish_state="published"` before asynchronous scanning, and
post-create hooks notify before mirroring/scanning. Copyright matching does not
establish general content safety. Preserve the known-DID gate until admission,
capacity controls, and the relevant content checks are verified together.

## Verification requirements

- Actual database events: exclude, unrelated event, clear, duplicate action,
  and exact-URI isolation. No public label or transparency post.
- Ingest create/update under exclusion or unavailable authority: no mutation,
  mirroring, scans, or notification. Deletes still work; unknown artists remain
  excluded until a separately verified admission change.
- Actual database reconciliation preserves restrictions on credential loss,
  HTTP failure, and malformed responses, while accepting a valid empty snapshot.
- Actual Postgres and WebSocket replay: over 1,000 labels, concurrent commits,
  absent/delayed broadcasts, subscriber lag, reconnect, and future cursors.
- Census pagination, budgets, unreadable repositories, explicit exclusions,
  policy conflicts, and independent label signature/frame decoding.

Moderation currently has no separate staging service (#1165). A service change
merged to main deploys the shared production service immediately; backend-only
changes first deploy staging. Treat those deployment boundaries separately.

## Delivery status

- Snapshot validation landed in #2149 (merged October 16); production backend
  promotion remains separate. Staging deployment failed before rollout because
  its database is stamped with `b6e2f4a1c9d3`, from unmerged native sign-in
  PR #2142. With Nate's explicit instruction to set aside the experiment, the
  migration was downgraded using its own Alembic downgrade to `311b4f106c90`.
  The retry succeeded: staging release v648 now serves main, including #2149;
  its health check passes and `/auth/app/start` is absent from OpenAPI.
  Production stayed at `311b4f106c90` and was not changed.
  The code remains on `claude/native-app-signin`; a no-compute Neon snapshot
  `archive-ios-experiment-2026-10-16` (`br-patient-band-af0k8vzz`) preserves the
  staging database before rollback. The removed table held 13 expired login
  attempts; no native exchange tokens were outstanding.
  Its full backend suite passed (1,831 tests;
  25 existing credential-gated skips), and all PR checks passed.
- The service proposal adds exact-URI `indexing_exclude` / `indexing_clear`
  decisions and an authenticated, bounded batch query. Real Postgres/router
  tests cover the decision lifecycle, unrelated events, auth, invalid subjects,
  and review/label isolation. CI now runs the service tests against Postgres.
- The policy API and backend admission consumer are separate changes: deploy
  and verify the service endpoint before merging the backend consumer to main.
  The consumer checks create, pending finalization, and update before mutations
  or post-create/mirror work. Missing credentials, incomplete snapshots, malformed
  values, HTTP errors, and timeouts raise for the existing bounded task retry;
  deletes and the unknown-artist gate are unchanged. Clearing an exclusion grants
  no exception to the other checks. An outage beyond retry exhaustion still needs
  reconciliation; this is not yet a durable admission backlog.
- Neither admission enforcement nor the 42-subject manifest is live yet. Drift
  checks, protocol repairs, and version-aware projection remain work under the
  active goal. Policy snapshots cannot prevent a concurrent operator decision
  after the read, so audits must also detect indexed-policy conflicts.

## Existing automation and code references

The old `run-moderation-loop.yml` is dispatch-only, defaults to dry-run, and its
latest listed run is December 30, 2025. Its non-dry-run path auto-resolves LLM
false-positive assessments and sends DMs; it is not a suitable read-only drift
monitor. It was not run during this audit. The current five-minute backend
reconciliation checks value projections, not discovery completeness or content
safety.

- `backend/src/backend/_internal/jetstream.py:226`: unknown-DID gate.
- `backend/src/backend/_internal/tasks/ingest.py:170`: track admission and effects.
- `backend/src/backend/_internal/tasks/labels.py:24`: projection reconciliation.
- `backend/src/backend/_internal/clients/moderation.py:473`: label snapshot validation.
- `backend/src/backend/_internal/clients/moderation.py:569`: override snapshot validation.
- `services/moderation/src/xrpc.rs:99`: replay/live stream handoff.
- `services/moderation/src/db.rs:774`: historical negation lookup.
- `backend/src/backend/_internal/transparency.py:29`: explicit public-action allowlist.

## Label stream delivery repair

The delivery proposal pages through durable rows until caught up; broadcast
messages only wake that reader, never provide its sequence or payload. A
30-second catch-up poll handles absent notifications and other service
instances. That adds two lightweight reads per minute per connected subscriber
and may keep the moderation database active; account for this in cost monitoring.
Slow socket sends time out after 15 seconds. Invalid negative/future cursors are
rejected before upgrading the connection. Existing JSON framing is preserved
until the consumer-first CBOR migration is ready.

`store_label` now holds a transaction-level advisory lock before allocating the
sequence until commit. All application label writers use that method. Direct SQL
inserts that bypass it would violate the ordering contract and must not be used.
The database remains the authority if optional context storage or broadcasts fail.

Real Postgres/WebSocket tests cover 1,005-row replay, lagged/out-of-order/fake
broadcast payloads, reconnect, a writer with no broadcast, new-subscriber head
semantics, cursor rejection, and a held concurrent writer. All four new tests
fail on the previous implementation; the repaired service passes all 25 tests.
This repair is prepared for review, not deployed. CID applicability, historical
negation semantics, and standard wire encoding remain separate work.

## Consumer-first standard framing support

The backend consumer now accepts binary header/body CBOR frames using the
installed ATProto SDK's decoder, alongside the existing text JSON events.
Both paths validate the notification envelope before invalidating any cache
or advancing the cursor. Malformed frames and protocol error frames close the
connection through the existing reconnect path. Unknown operations/types are
ignored, and information frames are logged without advancing the cursor.

This is an invalidation notification, not a new source of label authority:
projection refresh still reads authenticated snapshots from the moderation
service. It does not infer content safety or verify label signatures from the
notification. The producer must retain JSON until this consumer is deployed to
both staging and production. The subsequent producer change must also use
protocol error frames for FutureCursor, rather than the intermediate HTTP 400.

Real socket tests cover both encodings with Redis invalidation and Postgres
projection updates, malformed/error frames with no cursor advance, and forward
compatibility with unknown message types. Nine new cases fail on the previous
consumer; the legacy JSON case passes on both versions.

Protocol reference: https://atproto.com/specs/event-stream and
https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/label/subscribeLabels.json.
