# large public uploads

Implementation contract for the first large-upload foundation. This does not
complete protected uploads, transcoding, or restricted download parity.

## ownership

The existing Next audio Worker owns multipart bytes and their recovery. One
Durable Object per owner serializes upload operations and persists session
metadata, receipts and alarms. The Zig coordinator verifies a distinct upload
service-auth permission and issues short-lived, upload-scoped capabilities.
It never receives media bytes or creates a PDS record. The client reserves its
canonical track URI before upload and alone creates that record.

Published `audioBlob.maxSize` remains 104857600. Files up to 1610612736 bytes
use the existing `audioUrl` record shape. The existing verified blob mirror
and its `/audio/{cid}` namespace remain separate.

## admission

`POST /v1/uploads/authorize` on the coordinator accepts:

- `serviceToken`: service JWT for the configured coordinator audience, with
  the environment-aware `fm.plyr.upload.authorize` method (not Jam join).
- `uploadId`: client-generated UUID, reused on retries.
- `recordUri`: reserved canonical track URI, owned by the authenticated DID,
  using the configured track collection and a valid record key.
- `sizeBytes`: positive integer, at most 1610612736.
- `contentType`, `fileType`: supported audio format pair.
- `visibility: "public"`, `downloadPolicy: "open"`.

The response contains `uploadUrl`, a short-lived `capability`, and `expiresAt`.
Capabilities bind the owner, reserved URI, upload ID, size, type and policy.
Refreshing requires fresh owner authentication and identical immutable fields.
No bearer credential is persisted by the client. OAuth web/native metadata
must explicitly request the upload method permission before the client ships.

Admission does not accept private, protected, supporter or restricted-download
uploads. A public playback URL is not a general download authorization.

## transfer

The audio Worker exposes `/v1/uploads/{ownerHash}/{uploadId}`:

- `POST`: start or resume the immutable session; reject mismatched reuse.
- `GET`: state, fixed part size, part count, acknowledged parts with digests,
  reserved digests for uncertain parts, `recoveryRequired` and `reservedBytes`.
- `PUT /parts/{number}`: exactly the expected bytes, with server-owned receipt.
- `POST /finish`: assemble all persisted receipts and return stable `audioUrl`.
- `POST /activate`: check the reserved record and activate if authoritative.
- `DELETE`: cancel an unpublished transfer after checking publication ambiguity.

Parts are 10485760 bytes except the final part. The maximum file has 154 parts.
Only two unfinished sessions and 3221225472 reserved bytes are allowed per owner.
The Worker never trusts client-supplied completion receipts. Repeated parts,
finish, activation and cancellation must have defined idempotent outcomes.
Concurrent operations are serialized per owner, including finish versus cancel.

Media bytes live under an inaccessible R2 upload namespace. The stable public
URL is `/media/{ownerHash}/{uploadId}` and returns no bytes until activation.
Playback uses Range and HEAD without buffering the complete object. This
namespace does not claim content-addressed integrity or `verified_blob_cid`.

Appending `?download=1` to the published media URL serves the same bytes with
`Content-Disposition: attachment` and a fixed `audio.<format>` filename from the
validated upload session. Client-supplied filenames are ignored. GET, HEAD,
Range and cache behavior are unchanged; unpublished media still returns 404.
This downloads the object served by that URL, not a separate original source.

## publication and recovery

Finish stores its intent before the R2 completion side effect. If completion
succeeds but its response is lost, object HEAD recovers the same complete state.
A persisted alarm starts authoritative record checks even if the browser closes
before calling activate. The check resolves the owner's current PDS and checks
the latest reserved record, exact URL, configured collection, public/open policy
and absence of protected fields. A supplied CID is a concurrency hint; a newer
valid owner record can still establish ownership. No derived appview row is
edited to force publication.

The client keeps its stable reservation and reconciles ambiguous PDS creates
at that exact URI. It must never silently create another key to recover.

Unfinished transfers expire after 24 hours. Completed unpublished sessions get
bounded recovery attempts with backoff; failed authority lookup never authorizes
deletion. After the recovery window, unresolved sessions remain private and
quota-bearing for owner recovery, without an endless polling loop. Confirmed
published sessions leave the active quota. Completed-session cancellation returns an explicit recovery conflict even when
the record is absent: an in-flight client create can still race that absence.
This foundation does not complete cancellation, offboarding, or later conversion
of published public audio to protected storage. Published media URLs remain
public after activation. R2's
incomplete multipart lifecycle provides an additional cleanup backstop.

## verification and delivery

Regression coverage must include admission identity/scope/bounds, quota and
owner isolation, part-size mismatch, receipt persistence, concurrent retries,
restart after each side-effect boundary, complete-response loss, close-before-
activation recovery, authority outage, policy rejection, and no prepublication
bytes through GET/HEAD/Range. Small local parts test mechanics; synthetic size
metadata tests the 1.5 GiB boundary without moving large media on this laptop.

Provisioning uses a new `UPLOAD_CAPABILITY_SECRET`, separate from the existing
mirror `UPLOAD_TOKEN`. Keep its canonical value in the encrypted secrets store;
GitHub's `PLYR_NEXT_UPLOAD_CAPABILITY_SECRET` transports it to the audio deploy
job, and the Next coordinator receives the same value as a staged Fly secret.
Set the coordinator's `UPLOAD_BASE_URL` to the existing audio Worker's origin.
The deploy job writes only this new binding to a private temporary JSON file,
passes `--secrets-file` to Wrangler, and removes the file on exit. Existing mirror
secrets are preserved. Do not use `wrangler secret put`, which immediately
deploys a Worker version. Rotation repeats the coordinated store,
GitHub and staged Fly updates followed by the normal CI deployments; outstanding
upload capabilities must be refreshed by authenticated owners.

CI tests and deploys the existing audio Worker from published main alongside
its Durable Object migration. Backend admission ships before dependent client
code. Deployment acceptance must prove exact versions and a disposable small
fixture with teardown; no production account writes are part of this slice.

After both exact deployment versions are verified, dispatch the existing
`next audio service` workflow on main with `verify_upload=true`. The fixture
uses the existing `ZAT_TEST_*` account secrets and Cloudflare credentials. It
requires R2 object-delete permission and preflights that permission against its
fresh generated key before staging bytes or creating a record. It
creates one fresh integration-test record, stages 4044 bytes, verifies signed
activation and GET/HEAD/Range, then deletes only its generated PDS key and exact
R2 object. The cleanup keys cannot be supplied by workflow input. A published
receipt remains as bounded test metadata, without active quota or alarms; this
is not full resource erasure. Failed activation can retain a 4044-byte recovery
reservation. Diagnose that failure before another run rather than exhausting
the account's two-session quota. The fixture has no production target option.
It uses app-password service authentication; real browser/native OAuth consent
for the new upload permission remains a separate acceptance requirement.

Use `full_size=true` on that same manual workflow for actual 1.5 GiB R2
acceptance. It is restricted to a Linux GitHub Actions runner. A deterministic
192 kHz stereo WAV is generated in at most 10 MiB reads; the real client
transport and transfer engine upload all 154 parts. The fixture deliberately
loses one acknowledged part response and resumes the same reservation after
checking its receipts. Playback is verified by streaming SHA-256 and exact byte
count, with attachment HEAD/Range checks. No complete-file buffer is used.
The receipt includes maximum read size and peak process RSS. This exercises raw
public storage, not transcoding or browser/native OAuth consent.

Full-size runs retain safe reservation identifiers, verification metrics and
cleanup results for three days; credentials are never included. The same exact
record/object cleanup runs on failure, with a separate 20-second cancellation
deadline. A failed completed upload or failed cancellation can still retain quota,
even after object deletion. Stop further full-size runs in that case and inspect
the retained reservation: the account has only two unfinished slots, and deleting
an object does not release its receipt's quota. Do not reset Durable Object state
or describe this as successful cleanup of the reservation.

After diagnosing a failed transfer, use `resume_upload_id` and
`resume_record_rkey` from its reservation artifact together with `full_size=true`
to continue that exact fixture. Preflight requires a transferring reservation
and an absent canonical record. It never starts another reservation or deletes
existing bytes before transfer; the client verifies every reserved digest before
sending missing parts. Its receipt distinguishes previously acknowledged parts
from a newly injected lost acknowledgement. Completed or published fixtures need
their own recovery investigation and are rejected by this transfer-only mode.

After the reviewed staging processing wiring is enabled, `verify_processing=true`
uses the actual client transport to request the MP3 recipe. Run its one-second
synthetic WAV first; add `full_size=true` for the 1.5 GiB source with a 128 MiB
output reservation. Both modes are Linux-CI-only. The runner needs ffmpeg and
ffprobe; missing tools fail before creating a fixture. The test waits for a
completed rendition without submitting another source or record, checks that
all media variants remain private before publication, then publishes the same
reserved URI using returned MP3 metadata.

Acceptance streams the original into SHA-256 verification and the MP3 into a
temporary disk file. It checks 320 kbps/44.1 kHz MP3 metadata, source duration,
complete decoding, manifest identity, attachment headers and exact byte ranges.
The temporary MP3 is removed before retaining artifacts. The authenticated
processing generation identifies the exact rendition object for cleanup;
executor logs separately provide baseline free space and peak owned scratch
file bytes for that upload/generation. Successful published fixtures remove
their exact record, original and rendition. Failed processing retains source,
output and quota for diagnosis rather than deleting beneath a live executor.
Do not dispatch another fresh fixture to work around such a failure. The raw
transfer resume inputs deliberately reject processing recovery.

For an authority failure, dispatch `diagnose_upload=true` instead. This logs in
to the same test account but creates no records or uploads. It inspects at most
three public collections with `limit=1`, then retains one public record CAR
(at most 4 MiB), the public DID key and endpoint, and stage/error metadata for
three days. Empty accounts are reported without manufacturing a record. Never
rerun failed write fixtures merely to obtain diagnostics or exhaust their quota.

R2 API constraints: uniform nonfinal parts of at least 5 MiB, completed uploads
can disappear from the multipart API after success, and incomplete uploads
expire after 7 days by default. Sources:
https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
https://developers.cloudflare.com/r2/objects/upload-objects/
