# Protected audio on the artist’s PDS

Implemented on staging by [#2233](https://github.com/zzstoatzz/plyr.fm/pull/2233),
commit `02ed1cd5d09ec923e84e251fd3b1135f4f53ef02`, October 28, 2026.
Production has not been promoted. Existing catalog objects are not migrated.
The companion [client change](https://github.com/zzstoatzz/plyr-python-client/pull/44)
is merged; this does not imply a new package release.

The account-wide cleanup gap found in [#2235](https://github.com/zzstoatzz/plyr.fm/issues/2235)
is fixed by [#2238](https://github.com/zzstoatzz/plyr.fm/pull/2238), staging commit
`141a178cc9fc1e4be946ad190d0c70e240e2d0fe`. It preserves the user's PDS deletion
choice and shared/active media. All 2,094 local backend tests passed, including
real Postgres/HTTP account deletion cases. Existing staging accounts were not
deleted for validation; per-track source cleanup was exercised live.

## Ownership and authorization

For a new protected public/unlisted upload, an artist whose PDS supports Spaces
owns the source in a dedicated `privateMedia/playback` Space. Its read policy is
public, its write policy is the member list, and its app allow-list contains the
exact deployed OAuth client ID. The artist remains the authority. Public read
and app authorization are separate checks: the backend presents a confidential
client attestation and receives an app-only credential, without borrowing an
owner or listener’s delegation.

Only the uploader’s PDS needs Spaces. Anonymous listeners and listeners on a PDS
without Spaces use the ordinary plyr audio routes. Listening gates and download
permissions are enforced before source reads or mirror signing. Member-private
tracks retain their separate `self` Space and requesting-reader delegation;
this change does not make their metadata or audience public.

An unsupported uploader must explicitly accept plyr-only private storage for
that upload (`accept_plyr_storage=true`). A supported PDS refusing authorization
or a write is an error. A failed capability probe is also an error, rather than
permission to choose R2. `/auth/me` distinguishes host support from granted
permissions; a transient discovery failure must not break sign-in. The host
signal is `describeServer.spacesAlpha`, cached for five minutes. The owner
permission bundle covers both `self` and `playback`, so older sessions may need
to approve the expanded bundle before uploading.

## Source and mirror

`Track.protected_audio` and `TrackRevision.protected_audio` retain a source
record URI/CID and protected BlobRefs, plus a local mirror-verification flag.
Public track records expose `audioSpace` and `downloadPolicy`; API responses
expose `audio_space`. Neither public metadata nor `pds_blob_cid` carries the
protected BlobRefs. `space_uri` continues to identify member-private metadata.
All NSIDs and the allowed client identity are environment-aware.

The source blob and immutable source record must be written to the artist’s
PDS before publication. Private R2 is an optional delivery mirror. A failed
mirror or staging-object cleanup does not undo successful source ownership.
Resumable chunks still travel through private R2 staging; the worker then
establishes the PDS source before promoting the delivery copy. This is a
transport detail, not a second canonical location.

Playable Spaces inputs retain their format instead of waiting for a redundant
MP3 conversion. Deferred optimization publishes a new source record and retains
the original BlobRef. Replacement, revision snapshots, restoration, pruning,
exports and deletion follow those source references. Shared source records are
removed only after their final track/revision reference disappears. Ambiguous
publication or cleanup failures retain an asset rather than risk deleting live
audio. Changing download permission does not require moving an existing source.

Ingestion validates source authority, environment and collection. A record MAC
authenticates the source URI/CID; canonical DAG-CBOR hashing binds the returned
value to that CID. Even an unchanged source URI is resolved on a public metadata
update, since another authorized client could mutate that record. A mirror is
trusted only after its actual PDS bytes match the blob CID, size and claimed
file hash. A concurrent source change prevents the verification marker from
being applied to a newer version. Only verified mirrors can supply processor
URLs; transient mirror failures get bounded background retries.

Playback obtains an app credential before using a verified private mirror. A
missing or unverified mirror streams from the PDS, including Range and HEAD.
Original downloads authorize the selected track ID, so a public sibling sharing
its rendition hash cannot authorize a different protected master.

Authorization is subject to credential and URL lifetimes. The client cache uses
the earlier of the credential expiry minus 30 seconds and a 50-minute cap.
Private R2 URLs default to one hour. Revoking app access does not recall already
issued credentials, URLs or delivered bytes. Downloads-off controls approved-app
distribution; it cannot prevent saving received playback or recall historical
public copies.

## Staging evidence

The complete real-service harness passed 29 recorded checks on October 28:

- PDS source ownership, exact app allow-list, denial without app attestation,
  and denial through public `getBlob`.
- Anonymous and non-Spaces listening, byte ranges, HEAD, listener download
  refusal and byte-exact owner recovery.
- Deleting the actual private R2 object, then streaming the same bytes directly
  from the PDS with no redirect, including seek and owner recovery.
- Rebuilding an index through Jetstream without an upload reservation, and
  applying a direct PDS metadata edit without losing source ownership.
- Replacement, owner-only revisions, restoration and shared-source deletion.
- Explicit consent for unsupported-PDS storage.
- A two-part 11,520,084-byte upload: interruption, incomplete-finish refusal,
  resume and final protected PDS ownership.
- Publishing raw `.aif`, then deferred MP3 optimization while retaining
  byte-exact recovery of the original source.

All harness tracks, source records and temporary API tokens were cleaned up.
ZDS returns 404 for `deleteSession`; the harness records that limitation rather
than claiming the separately minted PDS inspection session was revoked.
Seven additional live album ZIP checks passed: exact original bytes, denied
anonymous/nonowner access before and after caching, and exact artifact cleanup.
The large capacity case exposed a separate R2 promotion timeout tracked in
[#2236](https://github.com/zzstoatzz/plyr.fm/issues/2236). The bounded multipart
fix merged in [#2237](https://github.com/zzstoatzz/plyr.fm/pull/2237), passed
2,078 local backend tests and a real three-part R2 copy/cleanup pilot. The full
[staging integration rerun](https://github.com/zzstoatzz/plyr.fm/actions/runs/40755846905)
passed all 23 cases: 22 normal cases in 584.43 seconds and the full 1.5 GiB
upload/playback/cleanup case in 1,036.78 seconds. The later account-only change
retains that upload implementation. Its [final ordinary suite](https://github.com/zzstoatzz/plyr.fm/actions/runs/40761156430)
passed all 22 cases in 562.78 seconds; ten focused source cleanup checks also passed.

The real OAuth browser matrix passed at 1280px/390px, light/dark, with mobile
touch. It checks the ownership UI, real anonymous playback, Range, download
refusal, tag analysis and browser errors. Detailed integration results are
recorded in the [implementation plan](../plans/2026-10-28-protected-pds-audio.md).

Initial #2233 validation passed 2,060 backend tests (26 existing skips) and all
385 frontend tests, plus types, lint, accessibility, API/client contracts and
private-media browser checks. The later R2/account fixes increased the backend
suite to 2,094 passing tests. See the linked PRs for exact CI runs.

## Running the smoke safely

Use `scripts/smoke_protected_audio.py` against `api-stg.plyr.fm` only. Without
`--execute` it sends no requests. Supply disposable test accounts and staging
mint access through a process environment or fixture file; a local development
mint secret does not authorize staging. Never print tokens or copy a development
`.env` into another deployment.

Maintenance operations run Python on a separate temporary machine,
identified by `PLYR_SMOKE_MAINTENANCE_MACHINE`. Clone the staging worker’s exact
image/config with `sleep 1800` as its command and no HTTP service, and destroy
that temporary machine in a `finally` path after the test. Do not run the
supplemental interpreter on the API machine. The helpers validate fixture owner,
ID and filename/hash, refuse shared mirror deletion, and bound the remote
process lifetime.

The first stress attempt launched that interpreter on the 1 GiB API machine
while integration uploads were active. Fly recorded an OOM kill at 18:39:38 UTC;
the app restarted at 18:39:39. The isolated rerun kept health checks passing and
caused no additional restart. The failed fixtures were removed. Timeout error
logging exposed temporary browser session cookies; those precise sessions were
invalidated and cleanup logging was changed to omit request headers. No
production service or credential was changed.

The wire reference is the inspected upstream
[permissioned-data revision](https://github.com/bluesky-social/atproto/tree/3a0b8c669881efa9e75680275f8695d618c5f80f/lexicons/com/atproto)
and [ZDS](https://tangled.org/zat.dev/zds). Protocol drift requires checking their
current code, not inferring request shapes from older proposal prose.
