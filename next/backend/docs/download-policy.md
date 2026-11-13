# track download preferences

`access.download_policy` carries the verified track record's `downloadPolicy`.
It is a preference, not permission to bypass effective listening access or
moderation. Consumers must refresh current access and refuse unknown policies.
The existing ingestion default is `open` when the field is absent on a public
audio record, and `off` when `audioSpace` is present. Explicit future values are
preserved rather than treated as open.

Migration 0038 leaves older projections null. Authenticated replay fills the
preference, including an idempotent replay of the same record CID; it does not
change service-owned visibility or moderation. Null remains unavailable until
verified replay. Deletion and replacement clear stale values atomically.
Changing an application download preference cannot revoke copies or previously
published public audio URLs. Protected/supporter download authorization and
original-file delivery remain separate requirements.

## supporter decision contract

`POST /v1/downloads/authorize` on the existing coordinator accepts only
`{serviceToken, recordUri, recordCid}`. The PDS-issued service JWT must name the
coordinator's configured audience and the environment's
`<track namespace>.download.authorize` method. Its verified issuer is the viewer;
a supplied viewer DID is not accepted. The eventual client requires a dedicated
OAuth RPC grant for this method, rather than reusing Jam or upload consent.

The coordinator fetches and verifies the current canonical public record proof,
requires the exact requested CID and explicit `supporters` download policy, then
uses the existing supporter verifier. The record author bypasses only the
supporter lookup. Owner-only/unknown gates, copyright self-labels, private record
shapes, and protected references outside the configured `SPACE_TYPE_NSID` remain
denied. Space-only records without a canonical public proof remain unsupported.
This is intentionally stricter than legacy owner-only download handling.

A successful response contains `viewer`, `recordUri`, `recordCid`,
`downloadPolicy: "supporters"` and a 30-second `expiresAt` in Unix milliseconds.
It contains no media URL or bearer capability and grants no byte access. The
client must still fetch matching current appview moderation/playback state and,
for protected audio, pass existing Space credential and response-proof checks.
Published public media URLs retain their existing permanence.

Responses use `Cache-Control: no-store`. Invalid inputs are 400, denied identity
or policy is 403, a changed/absent proven record is 409, and upstream/incomplete
checks or busy admission are 503. No negative decision is cached. One independent
admission slot protects existing playback/settings/upload admission. A total
15-second task budget covers identity, canonical proof and supporter checks;
timeout cancels and joins the task before freeing its arena. The operator can
shorten it with `DOWNLOAD_AUTH_BUDGET_MS` (1–15000), not extend it. The HTTP fixture
holds an actual identity response and verifies timeout, slot release and ready
responsiveness. This backend contract does not enable client supporter downloads
or close real-account OAuth consent acceptance.

## supporter sources

Supporter status (downloads, supporter Spaces and playback gates) comes from
attested.network payment proofs signed by a trusted broker, then optionally
atprotofans.com. `SUPPORT_TRUSTED_BROKERS` (comma-separated DIDs, default
broker.atmosphere.money `did:plc:7srqsetux75b6flzbbyag2ro`) and
`SUPPORT_ATPROTOFANS_FALLBACK` (`true` by default) configure them. Next's API and
coordinator set the fallback to `false`, so only attested proofs count there.
Support that exists only in atprotofans, with no attested payment record, does
not count on Next.
