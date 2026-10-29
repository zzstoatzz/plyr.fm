# Permission consent audit

Research date: October 29, 2026.

## Decision

Keep existing NSIDs and grants for the copy cleanup. Use consistent lowercase
product copy, concrete actions, and no claim that a permission set covers every
feature. Rename the displayed library set to “manage your plyr.fm library”, the
Spaces set to “manage and play protected audio”, and the Space type to
“plyr.fm audio”. Names do not change data visibility or existing authorizations.

These are source changes. Consent servers resolve published lexicons and may cache
them; merging or deploying the application alone does not publish these labels.
Publish the reviewed schemas separately and inspect an actual authorization screen
before claiming that users see the new copy.

## Current implementation

- `lexicons/authFullApp.json:8`: the old “Full” title overstated CRUD access to
  five public collections. Albums and playlists share the list collection; artist
  profiles were missing from the description. Blob uploads and Spaces are separate.
- `lexicons/privateMediaAccess.json:10`: one set combines artist management of
  `self`, cross-authority reading of `self`, and artist management of `playback`.
  Cross-authority reading does not bypass membership policy.
- `lexicons/privateMedia.json:7`: calling every Space private was inaccurate.
  Protected playback uses public read with an app restriction; member-private
  tracks use a separate Space. See the protected PDS audio architecture document.
- `backend/src/backend/_internal/auth/oauth.py:274`: ordinary sign-in requests
  Spaces permissions and retries without them on `invalid_scope`. Earlier docs
  describing opt-in-only consent were stale.
- `backend/src/backend/_internal/auth/space_scope.py:215`: the readiness predicate
  checks create/manage-create. `backend/src/backend/api/auth.py:559` requires that
  predicate for both Space keys, but the app also needs read/update/delete and
  membership management. This can overstate readiness; it is not evidence that
  PDS authorization can be bypassed.

The original title dates to February 8 (#889). Spaces grants changed July 20
(#1685), August 21 (#1898), and October 28 (#2233). The implementation has evolved;
its labels and explanations lagged behind.

## Ecosystem evidence

Published authority records were resolved through Lexicon DNS, DID documents,
and public `com.atproto.repo.getRecord` reads. Examples are deployed records,
not an assertion that their copy is exemplary:

| App | Observed design | Useful lesson |
| --- | --- | --- |
| [Bluesky](https://hollowfoot.us-west.host.bsky.network/xrpc/com.atproto.repo.getRecord?repo=did:plc:4v4y5r3lwsbtmsxhile2ljac&collection=com.atproto.lexicon.schema&rkey=app.bsky.authFullApp) | Broad app set plus separate create-post, delete-content, profile, notification, and other sets | Task-specific grants are established; capitalization varies even within one app. |
| [Leaflet](https://chanterelle.us-west.host.bsky.network/xrpc/com.atproto.repo.getRecord?repo=did:plc:btxrwcaeyodrap5mnjw2fvmz&collection=com.atproto.lexicon.schema&rkey=pub.leaflet.authFullPermissions) | Explicit CRUD over 14 collections | Descriptions should explain document/publication actions. |
| [Standard.site social](https://auriporia.us-west.host.bsky.network/xrpc/com.atproto.repo.getRecord?repo=did:plc:re3ebnp5v7ffagz6rb6xfei4&collection=com.atproto.lexicon.schema&rkey=site.standard.authSocial) and [full](https://auriporia.us-west.host.bsky.network/xrpc/com.atproto.repo.getRecord?repo=did:plc:re3ebnp5v7ffagz6rb6xfei4&collection=com.atproto.lexicon.schema&rkey=site.standard.authFull) | Two social collections versus four including publication/document | Reader/creator separation is viable; identical displayed titles obscure the distinction. |
| [BookHive](https://bluesky.nickthesick.com/xrpc/com.atproto.repo.getRecord?repo=did:plc:enu2j5xjlqsjaylv3du4myh4&collection=com.atproto.lexicon.schema&rkey=buzz.bookhive.auth) | Explicit CRUD for two collections | Concrete reading-list/review actions make detail understandable. |
| [Streamplace](https://hebeloma.us-west.host.bsky.network/xrpc/com.atproto.repo.getRecord?repo=did:plc:gqtagsooi75obldmytuow57q&collection=com.atproto.lexicon.schema&rkey=place.stream.authFull) | Broad set with 28 collections | “Full” naming is common, but does not make it useful or accurate for us. |
| [Tangled client metadata](https://tangled.org/oauth-client-metadata.json) | Granular repo/RPC/blob/identity scopes; no include scope | Not evidence of a permission-set naming convention. |

No usable deployed permission-set evidence was verified for teal.fm or WhiteWind;
do not infer their design from that absence.

The [official guide](https://atproto.com/guides/permission-sets) recommends related
permission bundles and supports progressive scope requests. Blob upload remains
outside sets. An `auth` prefix is a convention, not a reason to migrate our NSIDs.
`title` and `detail` are the consent-facing fields; `description` is schema prose.

The [October 14 Spaces update](https://atproto.com/blog/devex-goals-for-spaces)
still describes alpha, recent breaking changes, and primitives beginning to
stabilize. It distinguishes personal-private, syndicated/gated, and group data.
Our private and protected playback cases fit the first two. Treating the API as
fully settled would be premature.

## Recommended follow-up order

1. Make readiness honest: validate the operations each feature needs, including
   existing sessions with partial grants. Test refusal and upgrade paths against
   a real Spaces PDS. Avoid declaring every feature unavailable just because an
   unrelated reader grant is absent.
2. Introduce contextual consent only with matching product flows: listener/social
   permissions at sign-in, creator/library writes when publishing, and protected
   storage or shared-private reading when used. Split creator and reader Spaces
   sets if those flows actually request them separately. Preserve old-session
   upgrade paths and explain declines without repeatedly prompting.
3. Decide private publication independently of OAuth. A grant lets plyr operate
   on data; it does not make a public track record private. [Issue #2245](https://github.com/zzstoatzz/plyr.fm/issues/2245)
   tracks public PDS metadata remaining after owner-only listening. Decide how
   non-Spaces hosts, retraction, republishing, and failure recovery should work
   before changing record publication.
4. Evaluate narrower blob MIME scopes against every upload path. This is an
   authority change, not capitalization cleanup, and needs compatibility tests.

No grant expansion, NSID migration, record retraction, or consent-flow change is
part of this cleanup.
