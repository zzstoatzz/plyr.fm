# Upload sponsor prompt

The upload page offers GitHub sponsorship when the authenticated account's current
catalog exceeds `UPLOAD_SPONSOR_THRESHOLD_HOURS` (default `24`). Equality does not
qualify. The backend accepts finite, nonnegative fractional hours, so `0.01` is
useful for checking with a small catalog. Private and unlisted uploads count toward
eligibility; missing or malformed durations do not.

`GET /tracks/me/upload-summary` reads only the authenticated account's aggregate
uploaded seconds and seconds with a retained successful copyright scan. The card
refreshes on opening the upload page and after track or album completion. It does
not change upload permissions, send a notification, or start a scan. Failed config
or summary requests leave uploads usable and the prompt absent.

The displayed USD figure is an estimate: retained successfully scanned audio hours
× $1.50, the current Indie overage rate. It is explicitly before plan allowances,
not a personal invoice. Deleted tracks, replacements, retries and provider billing
reconciliation remain the separate usage-ledger work in #2163. Private audio with
no scan does not accrue a displayed scanning estimate.

Dismissal uses `ui_settings.upload_sponsor_dismissed_at` in account preferences and
lasts 30 days across devices. A failed preference save still dismisses the card for
the mounted page. The sponsor link opens in another tab to preserve the upload form.

## Production threshold check

Set `UPLOAD_SPONSOR_THRESHOLD_HOURS` on Fly app `relay-api` to the desired hours
(e.g. `fly secrets set UPLOAD_SPONSOR_THRESHOLD_HOURS=0.01 -a relay-api`). This
restarts backend machines; no frontend build is required. Check the live `/config`
value, then reopen `/upload` while signed in to an account with more than 36 seconds
of uploaded audio. The card fetches fresh config on each visit/completion.

Restore with `fly secrets set UPLOAD_SPONSOR_THRESHOLD_HOURS=24 -a relay-api` and
verify `/config` again. Lowering the threshold affects everyone and does not reset
an existing dismissal. For repeated checks, clear only your own
`upload_sponsor_dismissed_at` preference through the authenticated preferences API.
