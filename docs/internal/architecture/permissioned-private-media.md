# private media on ATProto permissioned spaces

plyr.fm's private-track experiment follows
[ATProto Proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data)
and [Permissioned Data Diary 7](https://dholms.leaflet.pub/3mqtqvjidqs2p).
The proposal is not a final specification, so this integration remains capability-gated
and intentionally isolated under `backend/_internal/atproto/spaces/`.

## what exists today

The shipped product is the smallest personal-space case:

- the artist is the space authority and only reader;
- the artist uploads through plyr.fm;
- the track record and audio blob live on the artist's PDS, never R2;
- the browser receives audio through plyr.fm's authenticated proxy because it does not
  hold a space credential;
- private tracks remain absent from public discovery, feeds, radio, search, and stats.

This is not yet a general shared-catalog importer. The client foundation can discover a
space's writer set and pull records or incremental operations from the correct repo hosts,
but plyr.fm does not persist a multi-writer permissioned-space replica or expose catalog
authorization UX yet.

## protocol roles

Proposal 0016 separates roles that happen to collapse onto one PDS in the personal MVP:

- **space authority**: DID that owns the space identifier and signs credentials;
- **space host**: issues credentials, publishes the writer set, and routes notifications;
- **repo host**: stores one writer's permissioned repo and blobs;
- **catalog-management app**: may create/configure the artist's space with OAuth manage
  permission without becoming its authority;
- **syncer/player**: plyr.fm after a user authorizes it to read the space.

The client resolves `#atproto_space_host` on the authority DID, falling back to
`#atproto_pds`. Writer reads resolve each writer's `#atproto_pds`; they must not assume
the logged-in user's PDS hosts every repo or the authority.

## space type, permission set, and addressing

The personal modality is `fm.plyr.privateMedia` (environment-aware through
`ATPROTO_APP_NAMESPACE`). Its Lexicon is a Proposal-0016 `type: "space"` declaration
whose default collection is `fm.plyr.track`.

OAuth requests `include:fm.plyr.privateMediaAccess`. That permission set grants the
artist's `self` space record read/write operations plus explicit `manage` operations.
The space declaration and permission set are separate NSIDs because the `main` definition
of a space type cannot simultaneously be a permission set.

Canonical identifiers are:

```text
space:  at://{authorityDid}/space/{spaceType}/{skey}
record: at://{authorityDid}/space/{spaceType}/{skey}/{authorDid}/{collection}/{rkey}
```

The earlier `ats://` experiment is rejected by current ZDS. The database migration in
this change rewrites existing `tracks.space_uri` and `tracks.atproto_record_uri` values to
the canonical form; ZDS independently migrates its resident space rows.

Because public and permissioned records now both use `at://`, code must use
`Track.space_uri` (or parse the fixed `/space/` marker) to distinguish them. A prefix
check is no longer sufficient.

## capability and OAuth upgrade

No stable declarative PDS capability exists yet. An authenticated
`com.atproto.space.listSpaces` probe remains the isolation point:

- a real response or route-level `InsufficientScope` proves support;
- `UnknownMethod`, `MethodNotImplemented`, `404`, or `501` means unsupported;
- ambiguous/transient failures fail closed and are not treated as support.

The result is cached per PDS and surfaced by `/auth/me`. Private-media OAuth permission is
requested only through the explicit scope-upgrade flow for a capable PDS, never during the
base login.

## space creation and policy

`com.atproto.simplespace.createSpace` receives the current proposal shape:

```json
{
  "did": "did:plc:artist",
  "type": "fm.plyr.privateMedia",
  "skey": "self",
  "config": {
    "policy": "member-list",
    "appAccess": {"$type": "com.atproto.simplespace.defs#open"}
  }
}
```

The required `simplespace` management layer has a member list even though the core sync
protocol does not enumerate readers. The authority is added by default and plyr.fm adds
nobody else, yielding owner-only access.

App access is open for this personal experiment so local/public OAuth clients can use it
without a confidential-client signing key. This is separate from user eligibility. A
future cross-app catalog can use `#allowList`, which requires a verified client
attestation.

## credential exchange and reads

The read path is:

1. The user's DPoP OAuth session calls `getDelegationToken` on their PDS.
2. plyr.fm resolves the authority's space host.
3. A confidential plyr.fm deployment creates a fresh, single-use ES256 client attestation
   with `typ=atproto-client-attestation+jwt`, its published OAuth client ID, and audience
   `{authorityDid}#atproto_space_host`. Public-client deployments omit it.
4. plyr.fm presents the delegation token and optional attestation to
   `getSpaceCredential` on the space host.
5. The resulting short-lived credential reads any repo in the space from that repo's own
   host.

The delegation token proves user-to-app delegation only; it does not identify the app.
App identity comes exclusively from the separate attestation. Credentials are cached for
50 minutes and renewed once after a `401`.

The generic client exposes:

- `list_spaces` on the user's PDS;
- `list_space_repos` on the authority host;
- `list_space_records` and `list_space_repo_ops` on each writer's repo host;
- ranged `open_space_blob` reads on the writer's repo host.

Proposal 0016 also defines full CAR recovery (`getRepo`), deniable LtHash commits, and
best-effort notifications (`registerNotify`/`notifyWrite`). plyr.fm does not yet keep a
durable permissioned-space replica, so it does not claim to implement or verify those sync
state transitions. ZDS's smoke suite remains the implementation-level coverage for that
substrate.

## track records and playback

Private media reuses the normal environment-aware `fm.plyr.track` record body with
`audioBlob` present and `audioUrl` absent. Record writes use
`com.atproto.space.createRecord`/`putRecord`; deletes use
`com.atproto.space.deleteRecord`.

`GET /audio/{file_id}` enforces owner visibility, obtains the space credential, then calls
`com.atproto.space.getBlob(space, repo, cid)` on the artist's repo host. It forwards the
browser's `Range` header and relays `206`, `Content-Range`, `Content-Type`, and length
headers so seeking works.

## third-party catalog interoperability

An upstream catalog manager and a downstream player can interoperate without either
becoming the artist's identity authority. For the use case "public listeners, but only
approved streaming apps may source the catalog," the proposal-shaped policy is:

- user policy: `public`;
- app access: `#allowList` containing the streaming clients' OAuth client IDs.

For a private audience, the user policy changes independently while app access can remain
allowlisted. Both axes must authorize credential issuance.

The critical boundary is the **space**, not an individual record. A credential reads the
whole space. Tracks with different audience or streaming-app distribution sets therefore
belong in different spaces (or in a future ecosystem convention that maps those policy
cohorts to distinct spaces).

App allowlisting is enforceable PDS access control, but it is not DRM or a licensing
language. Any usage terms beyond who may sync the space need a separate interoperable
record/convention and application enforcement.

## rollout and verification

Rollout order matters:

1. publish the `privateMedia` space declaration and `privateMediaAccess` permission set
   for the target environment namespace. The script reads `PLYRFM_HANDLE` and
   `PLYRFM_PASSWORD` from `.env`; never print the app password:

   ```bash
   # before merging to main (main auto-deploys staging)
   NAMESPACE=fm.plyr.stg uv run --project backend scripts/publish_permission_set.py \
     privateMedia privateMediaAccess

   # before the later production `just release`
   NAMESPACE=fm.plyr uv run --project backend scripts/publish_permission_set.py \
     privateMedia privateMediaAccess
   ```

2. deploy the backend and run the database URI migration;
3. run `scripts/permissioned_smoke.py` against an aligned ZDS account;
4. verify an existing migrated private track still plays and a new upload creates a
   canonical URI;
5. verify a non-supporting PDS continues to hide the private option.

Publishing must precede deployment because a newly upgraded browser session requests
`include:<namespace>.privateMediaAccess`; the PDS must be able to resolve that permission
set during authorization. Existing sessions without the include will be sent through the
normal one-time OAuth scope upgrade when they first choose private media.

The smoke script covers space creation, record/blob writes, credential exchange, record
reads, and ranged blob playback. Unit tests cover URI parsing, current config shape,
scope composition, attestation inclusion, host routing, credential renewal, and the public
record URL boundary.

The smoke script currently authenticates with an app password. It proves the aligned ZDS
data path, but not the browser OAuth scope-upgrade or confidential-client attestation path.
That browser-level interoperability proof remains in #1684.

## remaining product work

- choose or standardize the portable music-catalog space modality;
- add upstream-created space discovery and artist-facing authorization UX;
- persist and verify multi-writer sync state if plyr.fm becomes a proactive catalog
  syncer;
- implement notification registration and deletion/revocation cleanup for that replica;
- decide how distribution/licensing metadata is represented separately from access.

Those are product/interoperability layers above the now-aligned personal private-media
transport; they should not be folded into a listener member-list checkbox.
