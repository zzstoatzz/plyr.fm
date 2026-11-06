# Next platform stats

`GET /v1/stats` supplies `/stats` in the Expo client, linked from Settings.
This is a small public read model to curate as the rewrite progresses.

| Field | Definition |
|---|---|
| `tracks` | Non-deleted verified track records in the configured collection, on available accounts, with discoverable public/supporters policies and admitted moderation state. |
| `artists` | Distinct owners of those tracks, not every profile or account ever seen. |
| `duration_seconds` | Sum of those tracks' recorded durations; missing durations contribute zero. Catalog running time, not listener hours. |
| `plays` | Sum of application-owned canonical play counts for those tracks. Next-qualified listens, without importing production's historical totals. |
| `updated_at_ms` | When the database snapshot was read. |

Private/unlisted tracks, unavailable accounts, deleted records, excluded tracks
and unoverridden copyright labels are excluded. A moderation allow overrides
labels in the same way as the public catalog. Publicly listed supporter tracks
contribute metadata; this grants no media access.

One SQL statement reads all totals consistently. A successful snapshot is cached
for 60 seconds per API process, with a mutex preventing concurrent refreshes.
There are no new tables, counting triggers or per-event writes. Each instance
can have a slightly different snapshot age. Refreshing the page may return the
same still-valid snapshot. An unavailable index returns 503 rather than a
plausible-looking zero. Do not turn this into an unbounded live polling widget.

Real Postgres coverage includes visibility, deletion, account availability,
self/operator labels, moderation overrides, collection scope, empty catalog and
cache expiry. The HTTP smoke test checks failure and method behavior. The page
uses the shared wave loader and retry controls and explains its counting scope.

Add later metrics only with a definition, source, freshness/retention policy
and privacy check. Separate historical imported totals, Next listening activity,
public catalog size and private listening history instead of combining them
under one unlabeled number. The dated rewrite inventory remains the scope map;
this page is not a percent-complete estimate.
