# private media on permissioned spaces (design note)

resolves #1528. proves a minimum-viable **private-media** workflow on the experimental
ATProto permissioned-data surface (`com.atproto.space.*`), engaging only for accounts
whose PDS implements it. ports cleanly from today's public track flow: the record body
is the same `fm.plyr.track` lexicon — only the write target (a permissioned space repo)
and the read auth (a space credential) differ.

> **update (#1573): the protocol no longer has a reader member list.** ZDS removed the
> member-list routes (`addMember`/`removeMember`/`getMembers`/`getMemberState`/
> `getMemberOplog`/`notifyMembership`) and `getSpace`/`listSpaces` no longer expose
> `members`/`isMember`. the **space credential is the substrate**; reader/group semantics
> live **above** it, in the app. private-space credentials are owner-only by default.
> plyr.fm does not depend on any of the removed surface (audited: we never read
> `members`/`isMember` and never called a member-list route). access for this MVP is
> **owner-only by plyr's app-layer policy** — see the owner-model section. broader access
> (label rosters, artist-catalog membership, supporter tiers) is future plyr.fm app-layer
> state — ideally records in the relevant permissioned space — never a PDS member list.
> sections below that say "member list" describe the original (now-removed) protocol shape
> and are kept for history; the binding model is owner-only-by-app-policy.

## the first space type, and why it's the smallest meaningful one

`fm.plyr.privateMedia` (env-aware: `fm.plyr.dev.privateMedia` in dev). One artist-owned
personal space, `skey = "self"`. It holds **only** private audio — nothing else.

This narrowness is the point: per diary 6, granting an app a credential grants
**whole-space** read access, not per-record. So the space type *is* the privacy boundary.
Bundling drafts, proofs, DMs, or analytics into one space would mean one plyr.fm grant
exposes all of them. Private audio is the smallest slice that proves the end-to-end flow
(discover → space → blob → record → credential → playback) while keeping the blast radius
of a grant to exactly "this artist's private tracks."

## capability check (now, and the standards-shaped replacement)

No PDS advertises permissioned-space support declaratively — not `describeServer`, not
`.well-known`, not OAuth metadata. ZDS's `openapi.json` (with `x-zds-experimental: true`)
is vendor-specific and brittle, and the issue explicitly says not to lock onto it.

**Now:** an authenticated *method probe* — `com.atproto.space.listSpaces`. The method
dispatching for real (`200`, or a genuine `InvalidRequest`/`InsufficientScope`/auth error)
means supported; `404`/`501` or `MethodNotImplemented`/`UnknownMethod`/`XRPCNotSupported`
means unsupported. The probe must be authenticated: an unauthenticated call can't tell a
supporting PDS from a vanilla one, because PDS auth middleware returns `401` before method
routing (verified: `bsky.social` and a permissioned ZDS both `401` unauthenticated).
Result is cached per-PDS in Redis (6h) and surfaced on `/auth/me` as
`permissioned_spaces.supported`, which gates all UI. Code:
`backend/_internal/atproto/spaces/capability.py`.

**Later:** when the protocol defines a declarative capability (likely a `describeServer`
field), swap it in behind the same `detect_permissioned_capability()` function — the one
isolation point.

## owner model, access, and plyr.fm's client ID

- **Owner DID = artist DID.** Personal namespaces use the user's own DID (diary 5); no
  dedicated space DID is needed until ownership must transfer (shared/gated spaces).
- **Access: owner-only.** Post-#1573 the protocol has no reader member list — private-space
  credentials are owner-only by default, and any wider read ACL is plyr's app-layer concern.
  for this MVP the owner is the sole reader; write legitimacy is also app policy (below).
- **plyr.fm's OAuth client ID is default-allowed.** The space is created with
  `appAccessMode: "allow"` and empty `appExceptions`, so any OAuth client (including
  plyr.fm) may obtain a credential. A future shared-space pass can flip to an allow-list.
  ZDS binds the issued credential to the requesting client ID and enforces
  `spaceAllowsClient` at `getSpaceCredential` time.

## the read path: OAuth → member grant → space credential (with renewal/errors)

1. `getMemberGrant?space=<uri>` — authenticated with the user's **OAuth (DPoP)** token via
   `make_pds_request`. Returns a short-lived, one-use grant signed by the member's PDS,
   bound to plyr.fm's client ID.
2. `getSpaceCredential` (POST) — authenticated with the grant as a **plain Bearer** token
   (grants/credentials are JWTs, *not* DPoP-bound, so they bypass `make_pds_request`'s DPoP
   path via a raw-bearer helper). Returns an owner-signed space credential (~hours TTL,
   client-ID-bound), verifiable offline by any member PDS.
3. reads (`getRecord`/`listRecords`/`getBlob`) accept the credential as a plain Bearer
   token.

**Renewal:** credentials are cached per `(space, client_id)` for ~50 min; a read that gets
`401`/`InvalidToken` triggers one re-mint (grant → credential) and retry.
**Errors:** `AppNotPermitted` / `NotAMember` / `SpaceDeleted` surface as a typed
`SpaceAccessError`; `getSpaceCredential` requires the member DID to be PLC-resolvable (the
owner's PDS verifies the grant signature). Code: `backend/_internal/atproto/spaces/client.py`.

## the record, and how it references the blob

The audio blob is uploaded to the artist's PDS blobstore with the standard
`com.atproto.repo.uploadBlob`. The record reuses the **existing `fm.plyr.track` lexicon**
body (`build_track_record`) with `audioBlob` set and `audioUrl` omitted (no public URL
exists for private media), written into the space repo via `com.atproto.space.createRecord`
(`putRecord` for idempotent retries). The resulting record URI is the 6-segment
`ats://<ownerDid>/<spaceType>/<skey>/<authorDid>/fm.plyr.track/<rkey>`.

## playback via getBlob / range

Private tracks have no CDN URL. The backend stream endpoint obtains a space credential and
proxies `com.atproto.space.getBlob?space=&repo=&cid=`, **passing the client's `Range`
header through** and relaying the `206`/`Content-Range`/`Content-Type`/`Content-Length` so
seeking works (verified `206` ranged reads against a live ZDS).

## app-layer write legitimacy

The protocol no longer encodes write access (diary 6) — only a read member list. So
plyr.fm enforces, in app/indexer logic, that **only the record's author DID (== the signed-in
artist) may publish, edit, or delete** records in their private-media space. For this
single-member personal space that's simply "owner only." Shared/gated spaces will need
richer write/role policy.

## ZDS endpoints plyr.fm depends on (MVP)

`createSpace`, `getSpace`/`listSpaces` (capability probe + idempotent ensure),
`com.atproto.repo.uploadBlob`, `space.createRecord`/`putRecord`, `space.getRecord`,
`space.listRecords`, `space.getMemberGrant`, `space.getSpaceCredential`, `space.getBlob`
(with Range). All exist in the current ZDS source; the data path
(`createSpace`→`uploadBlob`→`createRecord`→`getRecord`/`listRecords`→`getBlob` ranged) is
verified against a local `ZDS_PERMISSIONED_DATA=true` build by `scripts/permissioned_smoke.py`.

## why shared/gated follow-ups need their own model

Supporter-gated, label-managed, or community spaces are **not** this MVP scaled up. They
need: a **dedicated space DID** (so ownership can transfer without breaking references), an
**arbiter / space host** (e.g. atprotofans) to manage membership, and **app-layer write/role
rules** above the protocol. They must not reuse the personal-space MVP unchanged. Tracked
alongside #564 (supporter gating) and #642 (time-release) on the permissioned-data substrate
(#1384).

## deferred (this PR)

- Non-web-playable private uploads: today's pipeline defers the canonical MP3 to the
  `optimize_track_audio` task, which writes the blob to the *public* repo. Routing that
  deferred write into the space is a follow-up; the MVP path covers web-playable audio
  (mp3/wav/m4a/flac), where the blob is written at publish time.
- Multi-member sync (member/repo oplogs, SetHash) — single-member spaces don't need it.
