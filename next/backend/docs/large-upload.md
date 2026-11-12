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

CI tests and deploys the existing audio Worker from published main alongside
its Durable Object migration. Backend admission ships before dependent client
code. Deployment acceptance must prove exact versions and a disposable small
fixture with teardown; no production account writes are part of this slice.

R2 API constraints: uniform nonfinal parts of at least 5 MiB, completed uploads
can disappear from the multipart API after success, and incomplete uploads
expire after 7 days by default. Sources:
https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
https://developers.cloudflare.com/r2/objects/upload-objects/
