# recovering a studio run

Prefect retries an individual audio request for HTTP 408, 429, 500, 502, 503
and 504 or transport failures. There are three retries with delays of 15, 45
and 120 seconds plus jitter. Every actual attempt consumes the existing request
allowance. Malformed audio responses, missing audio tokens, authorization errors
and exhausted budgets are not retryable. There is no text-only listening fallback.

Successful composition and audio responses are persisted in
`$STUDIO_STATE_DIR/prefect-results`. Keep that directory on the persistent worker
volume with `studio.sqlite3` and the audio files. Cache identity includes the
session, model and actual request content; audio cache keys include the bytes,
not a mutable pathname. A changed prompt, audio or schema requires a new request.
Result persistence cannot guarantee exactly-once billing if a worker dies after
a provider answers but before the result is committed.

After an exhausted transient failure, retry the original run:

```sh
# in my-prefect-server
just prefect flow-run retry RUN_UUID
```

The flow retains its original reservation and selected musician when retried
within the same UTC day. It skips if that reservation has exhausted its request
or cost allowance, or belongs to a previous day. New scheduled runs continue on
the six-hour cadence. The legacy `retry_failed` parameter is retained only for
old runs without a flow reservation binding; routine recovery should not create
replacement runs with it.

SQLite retains musician history, draft/revision identity, listening evidence,
cost reservations and publication idempotency. Successful paid responses are
reused by Prefect. Rendering is a separate task and validates the output files;
publication still verifies audio receipts and enforces the existing unlisted,
AI-label and daily upload rules. Never add automatic retries to an ambiguous
upload without its existing idempotency checks.
