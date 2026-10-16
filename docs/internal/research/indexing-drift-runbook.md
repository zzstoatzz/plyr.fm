---
title: "read-only indexing drift checks"
---

# Read-only indexing drift checks

Run daily or after a discovery/admission change. The report is evidence for
curation, not permission to ingest, proof of content safety, or a deletion plan.
Use the declared environment's database and collection; never combine staging
track rows with production discovery.

## Capture the index

Use the Neon connector to execute this read-only query against `plyr-prd`
(`cold-butterfly-11920742`) and save the `snapshot` object as JSON. It includes
all indexed URI shapes; the audit counts permissioned-space and other collection
records separately. The query captures its observation time in the same statement.

```sql
SELECT json_build_object(
  'observed_at', now(),
  'uris', (
    SELECT coalesce(json_agg(atproto_record_uri ORDER BY atproto_record_uri), '[]'::json)
    FROM tracks WHERE atproto_record_uri IS NOT NULL
  ),
  'artists', (
    SELECT coalesce(json_agg(json_build_array(did, handle) ORDER BY did), '[]'::json)
    FROM artists
  )
) AS snapshot;
```

## Run the census

From the repository root, with a recent snapshot:

```sh
cd backend
uv run python -m backend.utilities.indexing_audit \
  --collection fm.plyr.track \
  --index-snapshot /tmp/plyr-index-snapshot.json \
  --exclusions ../docs/internal/research/2026-10-16-indexing-exclusions.json \
  --output /tmp/plyr-indexing-audit.json
```

No application secrets are needed for the network census. It makes only GET
requests to discovery, identity, and repository metadata APIs. It never fetches
blobs, plays media, creates records, schedules scans, or sends notifications.
The exclusion manifest records the operator's instruction; its
`enforcement_status` is carried into the report. It is not evidence that live
admission enforces the instruction. Once live decisions are applied, refresh the
policy snapshot from the moderation authority; do not silently retain a cleared
exclusion from an old manifest.

The default limits are 1,000 repositories, 10 discovery pages per source,
20 record pages per repository, 1,500 requests, four concurrent requests,
4 MiB per response, 128 MiB total, and 10 minutes. Responses are consumed in
bounded chunks, so a byte limit can overshoot by an in-flight chunk per worker.
Redirects and compressed responses are refused. Each HTTPS request is pinned to
a public DNS result with the original TLS server name; private, link-local,
multicast, and mixed public/private answers are refused.

A snapshot older than one hour, a deadline, a cap, malformed data, or a failed
source/repository read makes `complete` false. Successful enumeration does not
establish global network coverage or an atomic cross-PDS snapshot. Record keys
are treated as opaque identifiers using the [protocol syntax](https://atproto.com/specs/record-key).

## Interpret and retain the result

- `intentional_exclusions`: observed records absent from the index and explicitly excluded.
- `unexplained_unindexed`: observed records missing without that instruction; investigate before restoring.
- `indexed_policy_conflicts`: indexed URIs with an exclusion, even if their PDS could not be read.
- `excluded_now_absent`: excluded URIs absent from a successfully enumerated repository.
- `excluded_presence_unknown`: absent from the observations, but their repository was unreadable or uninspected.
- `indexed_not_observed`: indexed public URIs absent from a complete repository read; inspect pending state and history before calling them stale.
- `repositories`, `sources`, `uninspected_dids`, and the limit/usage fields preserve coverage and uncertainty.

Exit 1 means incomplete evidence or an unexplained gap, policy conflict, or
indexed-not-observed record. It does not mean an abuse finding. Preserve the JSON
even on exit 1; the baseline has known unreadable repositories.

Compare finding URI sets, incomplete repository DIDs, failed discovery sources,
and unknown-artist DIDs with the previous successful audit invocation. Ignore
clock, byte-count, request-count, and ordering changes. Notify only on new or
resolved findings, new coverage failures, or failure to run the audit. Do not
repeat the 42 intentional exclusions or unchanged known gaps each day. Retain the
last usable report if a run crashes; never replace it with an empty snapshot.

The October 16 baseline has 42 exclusions, nine unexplained gaps, no policy
conflicts, five unreadable repositories, and one indexed-not-observed URI: track
930 (@flo.by), already documented as pending with missing media. Production
still has 1,186 indexed public-collection URIs; three permissioned-space URIs
are outside this census. This inventory says nothing about whether audio is safe.

## Moderation snapshot

Run `moderation-drift-snapshot.sql` read-only against `plyr-moderation`
(`rough-hall-37695610`), not the application database. It returns current label
metadata, the queue derived from opening/closing events, historical-retraction
conflicts, and current private-exclusion counts. Preserve the observation time.
It follows deployed local sequence ordering and exposes CIDs rather than
pretending URI-only applicability is sufficient.

At 19:09 UTC on October 16, the verified values were 747 label events, three
active sexual labels, zero active reassertions with older negations, 65 open
review subjects (oldest July 25), and zero live indexing exclusions. The queue
rose from 62 because production tracks 1445–1447 by
`addline.selfhosted.social` received fingerprint-match events 215–217. These are
review signals, not findings of infringement. Do not rewrite the earlier census
baseline to conceal this change. The production context table already has
`track_id`; #2155 repairs fresh-database bootstrap rather than a live missing
column.

Compare active label URI/value/CID sets with production track URI/CID and
`operator_labels` in a separately timed `plyr-prd` read. Distinguish projection
value mismatch from CID applicability mismatch. Neither authorizes automatic
label retraction. Compare review subject sets as well as counts so opening and
closing work cannot cancel each other invisibly. The SQL summary is a starting
point; inspect event metadata for new subjects without fetching media.

Use `moderation-rollout.md` for deployment order and the conditions required
before admitting publishers who have never signed in.
