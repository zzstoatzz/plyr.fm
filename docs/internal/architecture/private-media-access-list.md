---
title: "private media access list — reconciliation and design"
---

Design for letting an artist name the people who can hear their private tracks.
Written after surveying the three access mechanisms plyr.fm already has, so the
list lands as one more *answer to the same question* rather than a fourth gate.
Not shipped; staging first.

## vocabulary (Proposal 0016, exact terms)

| term | meaning | plyr.fm today |
|---|---|---|
| space | an authorization and sync boundary, `(authority, type, skey)` | `at://{artist}/space/fm.plyr.privateMedia/self` |
| space authority | the DID that is the root of authority; decides who gets credentials | the artist |
| space host | the service that answers for the space: mints credentials, enumerates writers, routes notifications | the artist's PDS (`#atproto_space_host`, fallback `#atproto_pds`) |
| repo host | stores one writer's permissioned repo and blobs | the artist's PDS |
| managing app | optional service the host asks at mint time (`checkUserAccess`) | none |
| space credential | token the authority issues that grants read access, DPoP-bound to the app it was issued to | minted by plyr for the owner's own session |
| delegation token | token a user's PDS issues that an app exchanges for a space credential | from the owner's PDS |

"Space owner" is not a protocol term; it means the authority. The authority
decides, the host executes, the repo host stores. They collapse onto one PDS
today and need not.

## how a reader gets in — and why links cannot leak

A reader never holds a URL that works. The reader's *app* asks the reader's
*own PDS* for a delegation token naming the space, exchanges it at the space
host for a credential bound to the app's DPoP key, and fetches `getBlob` with
that. Two consequences that shape everything below:

1. Access is by DID, always. A link is just `at://…`; a third party's app fails
   at mint time and plyr answers 404, as for any stranger. Credentials are not
   re-shareable either (DPoP-bound).
2. **A reader must be on a spaces-capable PDS.** The delegation token comes from
   the reader's PDS. A listener on bsky.social cannot be a member of anything
   until bsky.social implements spaces. Bulletin states the same constraint.

## the three access mechanisms plyr.fm has, side by side

| | supporters | private | downloads |
|---|---|---|---|
| unit | track (`visibility=supporters`, `support_gate={"type":"any"}`) | track (`visibility=private`) | artist (`UserPreferences.download_policy`: `open\|ask\|supporters\|off`) |
| who decides | a verifier: `validate_supporter` → atprotofans today, ATM/attested.network per #1871 | identity compare `session.did == artist_did` in `track_visibility.py`, `audio.py:504`, `audio.py:412` | `download_refusal` (verifier-neutral; takes `viewer_is_artist`, `viewer_is_supporter` as facts) |
| bytes | R2 private bucket, presigned URL (shareable for its lifetime) | PDS space, proxied through plyr with the owner's credential | R2 public bucket, presigned attachment URL |
| denial | 402 + `X-Support-Required`, existence advertised, CTA | 404, existence hidden | 401/403 by refusal kind |
| in feeds | yes, "locked" | never | n/a |
| freshness | 5-minute Redis cache, re-evaluated per request, expires naturally | instant | per request |
| private tracks | exclusive (one `visibility` column) | — | never downloadable, **not even by the owner** (`download_refusal` refuses `is_private` before consulting `viewer_is_artist`) |
| supporter-gated tracks | — | exclusive | never downloadable, even by supporters (`support_gate is not None` → `gated`) |

Three denial conventions, three byte paths, three freshness models. The
design below does not add a fourth; it makes "member of the artist's private
media space" a second source for one existing fact.

## what the access list is

`simplespace` already has it: `memberListPolicy` (what plyr creates today, with
nobody added) plus `addMember(space, did)`, `removeMember`, `listMembers`. The
list is **host-internal state consulted at credential-mint time** — not synced,
not enumerated to the network, readable only by the authority's OAuth session.
It lives on the artist's PDS, so it is portable and survives plyr.fm.

One space per artist means **one list for all private tracks**. That is the
product statement: "people who can hear my private tracks." Per-track sharing
is a later, separate decision (space per track, or Habitat-style relation
records) and is out of scope here.

## the legwork: what must change before a member can hear anything

### 1. the permission set (blocking, and it is a re-consent)

`lexicons/privateMediaAccess.json` grants `authority: "self"`. A member's
session therefore holds no grant for the artist's authority and their PDS
will not issue a delegation token for it. Bulletin's `my.bulletin.permissions`
grants `authority: "*"`. plyr needs a reader permission:

```json
{
  "type": "permission", "resource": "space",
  "spaceType": "fm.plyr.privateMedia", "authority": "*", "skey": "self",
  "collection": ["fm.plyr.track"], "action": ["read"]
}
```

alongside the existing owner permission (`authority: "self"`, full actions +
`manage`), revised **in place** under the existing NSID (PR #1898). Every
session re-consents to pick it up — the scope-upgrade path this week made
honest. Verified in zds source: `writeResolvedScope` substitutes the user DID
for `self` and passes `*` through, so the token carries
`space:fm.plyr.privateMedia?authority=*&skey=self&collection=fm.plyr.track&action=read`;
`getDelegationToken` requires a grant covering the *target* authority and signs
with the requester's own key without checking the authority is local.

### 2. the reader credential path (already mostly right)

`_mint_credential` asks **the requesting session's own PDS** for the
delegation token and posts to the **authority's** space host (routing tests
pin authority ≠ reader). The cache key is `(reader did, space)`. So once the
grant exists, `open_space_blob(session, space=<artist's>, …)` works for a
member unchanged. No server-held credential, no impersonation.

### 3. the owner-only identity compares → membership

- `track_visible_filter` becomes `not_private OR artist_did == viewer OR EXISTS member(artist_did, viewer)`;
- `can_view_track` / `ensure_track_visible` consult the same;
- `audio.py:504` and `audio.py:412` drop their bare DID compare for it.

This needs an app-side mirror of membership (a table keyed `(artist_did,
member_did)`), because the PDS list is not queryable in SQL and not readable
with a member's session. The **PDS list is the source of truth**; plyr's table
is a cache written through on every `addMember`/`removeMember` plyr performs,
and reconciled from `listMembers` with the artist's session (it cannot be
reconciled any other way). If the artist edits the list from another app, plyr
learns on the next reconcile; the PDS still refuses credentials instantly, so
plyr's cache can only ever *over-show metadata*, never *over-serve bytes*.

### 4. the client wrappers + endpoints + portal

- `add_space_member` / `remove_space_member` / `list_space_members` in the spaces client (mocked-boundary tests pinning payloads);
- `GET/POST/DELETE /artists/me/private-media/members` (sign-off needed: new surface);
- a section on `/portal/manage` reusing `HandleSearch.svelte` (the featured-artists multi-select) — resolved handles, avatars, remove;
- the picker copy stays honest: "only you and the people on your list can play it" once a list exists.

### 5. the rules the three tables above force

- **Denial for a non-member stays 404.** Private means existence is hidden; a
  member list does not turn private into "locked but advertised." If a track
  should be *seen* by everyone and *heard* by some, that is `supporters`.
- **Membership is not supporter standing.** `viewer_is_supporter` keeps meaning
  "the verifier said so"; add `viewer_is_member` as a separate fact where a
  function takes both. Never fold members into `supported_artist_dids`.
- **Downloads of private tracks stay refused** — for members *and* the owner —
  until there is a private byte path for downloads (`download_key` only knows
  the public bucket; private bytes have no R2 object). Lift the owner refusal
  as its own change when the proxy can serve an attachment.
- **Surfaces that short-circuit on `support_gate is not None`** (radio corpus,
  PDS-save eligibility, subsonic direct URLs) are untouched: private tracks are
  already excluded by `is_private`, and members do not change that.
- **Revocation is eventual, and the protocol says so.** `removeMember` only
  stops *future* mints; a space credential lives 2 hours, is verifiable
  offline against the authority's key, and has no revocation list (proposal
  §Space credential; zds `permissioned_data.zig` `exp = iat + 7200`). plyr's
  own credential cache (50 min, keyed `(reader did, space)`) must be dropped
  on `removeMember` so plyr never outlives the PDS's answer by more than the
  credential it already holds. Tell the artist plainly: "they can keep
  listening for up to two hours."
- **The authority is implicitly a member** and cannot be removed (zds
  `spacePolicyAllowsRequester` short-circuits on the authority;
  `removeSimpleSpaceMember` refuses it). The portal list is everyone *else*.
- **`listMembers` is owner-only** on every implementation except
  atproto-crates (reference: `read_self` scope plus an owner assert; rsky and
  zds: `manage=update`; atproto-crates: any member with `read_self`). treat it
  as owner-only; only the scope action varies. zds pages at most 100 per call.
  plyr's mirror is reconciled with the artist's session only. the full table is
  in zds `docs/permissioned-data.md` under "client-visible contract".
- **There is no discovery primitive.** Being on a member list does not make the
  space appear in the member's `listSpaces`, and the protocol never enumerates
  readers. plyr must tell members what was shared with them at the app layer
  (a "shared with you" surface), never by publishing a public pointer record —
  that is the existence leak the doodl notes warn about.
- **`appAccess` stays `open`.** `allowList` refuses every request without an
  attested `client_id`, which is every public browser client — members
  included.

## how this reconciles with attested.network / ATM (#1871)

Keep them separate, and keep the direction of authority clear:

- The member list is **the artist's explicit choice**, written by the artist
  through plyr (OAuth `manage`) — plyr is the artist's hands, not a gatekeeper.
- Supporter access is **a verifier's answer** about a payment, re-evaluated per
  request, expiring naturally. plyr is a verifier, never a broker.

Do **not** derive membership from payments (auto-`addMember` on a verified
event). It would make plyr an effectful actor on the artist's PDS driven by
broker webhooks, turn every missed `subscription.canceled` into an over-grant
nothing corrects, and collapse two freshness models into the worse one. If a
"supporters can hear my private space" mode is wanted later, it is
`managingAppPolicy` with plyr's `checkUserAccess` calling `validate_supporter`
— the verifier answering at mint time, no list to keep in sync. That is a
different policy on the same space and a separate decision.

## staging plan (each a PR; prod only when the whole arc is right)

1. permission set: add the `authority: "*"` read permission; publish to staging; re-consent via the (now honest) scope upgrade; e2e asserts the expanded grant includes it.
2. spaces client: member wrappers + tests; two-account extension of `scripts/permissioned_smoke.py` proving a non-owner member streams a ranged `getBlob` through `getSpaceCredential`.
3. membership mirror + `track_visible_filter` / `can_view_track` / audio checks; regression tests: member sees and streams, non-member 404s, owner unchanged, revocation takes effect.
4. endpoints + portal section; e2e: owner adds the second fixture account, that account plays the private track in a real browser, owner removes, playback 404s.

The second fixture account must be on a spaces-capable PDS. bufo.uk (zds) plus
`nate.spaces-alpha.bsky.network` (official) is the pair that proves both
implementations and cross-host membership at once.
