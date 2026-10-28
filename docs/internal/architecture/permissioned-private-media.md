# private media on ATProto permissioned spaces

plyr.fm's private-track experiment follows
[ATProto Proposal 0016](https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data)
and [Permissioned Data Diary 7](https://dholms.leaflet.pub/3mqtqvjidqs2p).
The proposal is not a final specification, so this integration remains capability-gated
and intentionally isolated under `backend/_internal/atproto/spaces/`.

The wire contract is the **spaces-alpha lexicons** at the tip of the `permissioned-data`
branch of [bluesky-social/atproto](https://github.com/bluesky-social/atproto/tree/permissioned-data/lexicons/com/atproto)
(`lexicons/com/atproto/{space,simplespace}`) — not the proposal prose, which lags them.
[Bulletin](https://github.com/bluesky-social/bulletin) is the alpha's reference client;
when a request shape is in doubt, match what its `lib/atproto/` does. ZDS tracks the same
branch, and has rejected stale bodies twice (#1656, #1876).

## deployment and product boundaries

The October 28 protected playback path is deployed to staging; production
promotion is pending. See [protected PDS audio](protected-pds-audio.md) and the
[validation plan](../plans/2026-10-28-protected-pds-audio.md). Existing catalog
sources are not migrated automatically.

The member-private `self` Space retains its own boundary:

- the artist is the space authority; the artist and admitted members can read;
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

The current client resolves the authority host through `#atproto_pds`, matching
the October alpha. It does not consult `#atproto_space_host`. Writer reads resolve
each writer's `#atproto_pds`; they must not assume
the logged-in user's PDS hosts every repo or the authority.

## space type, permission set, and addressing

The personal modality is `fm.plyr.privateMedia` (environment-aware through
`ATPROTO_APP_NAMESPACE`). Its Lexicon is a Proposal-0016 `type: "space"` declaration
whose default collection is `fm.plyr.track`.

OAuth requests `include:fm.plyr.privateMediaAccess`. That permission set grants the
artist's `self` and `playback` space record read/write operations plus explicit
`manage` operations. The self Space uses member read policy; the playback Space
uses public read policy and an exact deployed-app allow-list.
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

PDS support and OAuth permission are separate. `describeServer.spacesAlpha=true`
is the support signal, cached per PDS for five minutes. A failed probe is unavailable
(503 at the upload boundary), not permission to store protected audio only in R2.
`/auth/me.permissioned_spaces.supported` reports capability; `granted` requires
both the self and playback grants. If its capability read temporarily fails,
`/auth/me` uses the existing grant as its conservative support signal.

Permissions are requested through an explicit scope upgrade when needed, not on
every base login. `space:` grants are parsed by `_internal/auth/space_scope.py`.
The expanded permission set covers self/member-private and playback writes; app
password sessions have the existing owner authority. A capable PDS that refuses
a scope or source write fails the operation. A host without Spaces may use
private R2 only for a new upload with explicit `accept_plyr_storage=true`.
This exception does not apply to member-private uploads or authorize migration.

Earlier releases inferred capability from a token's expanded grants and remembered
unsupported hosts. That historical inference is no longer the discovery contract.

## space creation and policy

`com.atproto.simplespace.createSpace` receives the alpha body. The space is anchored on
the authenticated DID (no `did` field), and `readPolicy`, `writePolicy` and `appAccess` are `$type` unions:

```json
{
  "spaceType": "fm.plyr.privateMedia",
  "skey": "self",
  "readPolicy": {"$type": "com.atproto.simplespace.defs#memberListPolicy"},
  "writePolicy": {"$type": "com.atproto.simplespace.defs#memberListPolicy"},
  "appAccess": {"$type": "com.atproto.simplespace.defs#open"}
}
```

The `simplespace` management layer has a member list even though the core sync protocol
does not enumerate readers. The authority is authorized on its own member-list space
without an explicit member grant; plyr.fm's portal access list adds and removes further
members through `simplespace.putMember` (read-only)/`removeMember` (see private-media-access-list.md).
`getSpace` returns `{uri, readPolicy, writePolicy, appAccess}` with the same unions;
`updateSpace` takes `{space, readPolicy?, writePolicy?, appAccess?}`.

App access is open for this personal experiment so local/public OAuth clients can use it
without a confidential-client signing key. This is separate from user eligibility.
The separate playback Space uses `#allowList` for exactly the deployed client
and requires a verified client attestation. Public read policy does not make
its blobs available through public repo `getBlob`.

## credential exchange and reads

The member-private read path is:

1. The user's DPoP OAuth session calls `getDelegationToken` on their PDS.
2. plyr.fm resolves the authority's space host.
3. A confidential plyr.fm deployment creates a fresh, single-use ES256 client attestation
   with `typ=atproto-client-attestation+jwt`, its published OAuth client ID, and audience
   `{authorityDid}#atproto_pds` (the October 21 alpha dropped `#atproto_space_host`).
   Public-client deployments omit it.
4. plyr.fm generates a fresh P-256 key and posts an unsigned JSON body to
   `getSpaceCredential` on the space host: `space`, `credentialKid` (the key's
   `did:key`), `delegationToken`, and the optional `clientAttestation`. The credential
   is bound to that key.
5. The resulting short-lived credential reads any repo in the space from that repo's own
   host. Each read sends `Authorization: Atproto-Space-Credential <credential>`, an
   `atproto-space-audience` header naming the DID whose host is being asked, and an HTTP
   message signature labelled `atproto-space-credential` over both, with
   `tag="atproto-space-credential"`, made with the same key.

Until 2026-09-29 the binding was DPoP (a `dpop` proof per request and a `DPoP`
authorization scheme). Upstream replaced it with signatures; a host on the newer
branch answers the old form with `401 BadSpaceSignature`. On 2026-10-22 upstream moved
the delegation token and key out of a signed issuance request into the body
(`credentialKid`), renamed the read scheme to `Atproto-Space-Credential`, and tagged the
signature; an older client gets `400 Missing credentialKid`.

The same release replaced signed commits with MACs. A credential read of
`getRecord`, `getRepo`, `getLatestCommit` or `listRepoOps` must send
`Atproto-Space-Want-Mac` with a fresh P-256 key share (ECDH against the author's
`#atproto_kem` key, DHKEM(P-256, HKDF-SHA256) as in RFC 9180); the host returns the
commit's HMAC in `Atproto-Space-Mac`, or `BadSpaceMac` without the header. `getBlob` and
`listRecords` carry no MAC. `spaces/mac.py` ports `kem.ts` and `mac.ts` (checked against
the RFC 9180 vector), and `list_space_repo_ops` requests and verifies the commit MAC
whenever the author publishes a KEM key. Hosts that predate KEM keys get no header.

The delegation token proves user-to-app delegation only; it does not identify the app.
App identity comes exclusively from the separate attestation. Public-read playback
credentials omit user delegation and use the deployed client's attestation. This
allows anonymous playback without borrowing a member-private owner's credential.
Credentials are cached for at most 50 minutes, shortened to JWT expiry minus 30
seconds when available, and renewed once after a `401`. Protected playback checks
that credential before using a verified mirror. Issued private R2 URLs default to
3600 seconds, so revocation is bounded by credential and issued-URL lifetimes.

The generic client exposes:

- `list_spaces` on the user's PDS;
- `list_space_repos` on the authority host;
- `list_space_records` and `list_space_repo_ops` on each writer's repo host;
- ranged `open_space_blob` reads on the writer's repo host.

`listRepos` and `listRepoOps` page by `cursor` (default 100, max 1000): a full page
carries `cursor`, the final page omits it. `listRepoOps` additionally returns the
`commit` only on the page that reaches the head of the oplog, so a consumer must not
expect `commit` on every page. Both client functions accept `cursor`.

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

`GET /audio/{file_id}` enforces member-private visibility using the requesting
reader's credential, then calls
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

The following is the earlier member-private rollout procedure. For the October
28 staging deployment and its protected-audio checks, use the linked validation
plan; production is not yet promoted. Publishing the permission set before scope
upgrades remains necessary.

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

The permission set `fm.plyr.privateMediaAccess` now carries owner permissions for
self and playback (`authority: self`, write actions and `manage`) plus the
member-private reader permission
(`authority: "*"`, `action: ["read"]`). The reader permission is what lets a
member's own PDS issue a delegation token for *another* artist's space; zds
passes `*` through at token issuance, so the expanded grant reads
`space:fm.plyr.privateMedia?authority=*&skey=self&collection=fm.plyr.track&action=read`.
`/auth/me` reports it as `permissioned_spaces.reader`. It never makes anyone an
owner: `private_media_grant_present` still requires the `self`-resolved
authority plus `manage=create`.

Before October's support discovery change, base sign-in requested the include
and capability was inferred from its expansion. That history explains the old
`scopes_supported` workaround, but does not describe current behavior: base login
omits the opt-in include, `spacesAlpha` discovers host support, and a scope upgrade
requests the self/playback grants when needed. Unsupported PDSes keep the private
option hidden. Public protected uploads can offer the explicit R2-only exception.

The smoke script covers space creation, record/blob writes, credential exchange, record
reads, and ranged blob playback. Unit tests cover URI parsing, current config shape,
scope composition, attestation inclusion, host routing, credential renewal, and the public
record URL boundary.

The smoke script authenticates resident operations with an app password, then proves the
signed credential exchange and ranged read path using a separate ephemeral key. It
does not prove the browser OAuth scope-upgrade or confidential-client attestation path.
Those limitations describe that member-private script. The October protected
source API and OAuth browser results are recorded separately in the validation
plan; they do not establish every cross-account member-private case.

## remaining product work

- choose or standardize the portable music-catalog space modality;
- add upstream-created space discovery and artist-facing authorization UX;
- persist and verify multi-writer sync state if plyr.fm becomes a proactive catalog
  syncer;
- implement notification registration and deletion/revocation cleanup for that replica;
- decide how distribution/licensing metadata is represented separately from access.

Those are product/interoperability layers above the now-aligned personal private-media
transport; they should not be folded into a listener member-list checkbox.
