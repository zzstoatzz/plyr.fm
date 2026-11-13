# Next client

The Expo / React Native app is the Next client for iOS, Android, and web.
The web export runs on `next.plyr.fm`. All targets use the Zig AppView for
catalog reads and the account's PDS for authenticated writes.

```sh
npm ci
npm run check
npm run web -- --localhost --port 5174
npm run ios
npm run android
npm run build:web
```

Run these commands from `next/app` with Node 22 or newer. The native commands
require a native development build and the corresponding simulator or emulator. Open the local web app at `http://127.0.0.1:5174` to use the Next API’s development CORS origin. The web build writes a
static export and OAuth metadata to `dist/`. Cloudflare Pages serves the
export with a fallback to `index.html` for routes such as `/oauth/callback`.
Both OAuth client IDs use `EXPO_PUBLIC_SITE_URL`, which defaults to
`https://next.plyr.fm`. The native OAuth redirect uses the
`fm.plyr.next:/oauth/callback` scheme, so it requires a native build that
registers the scheme. The API URL defaults to `https://api.next.plyr.fm`.

## Account sync

Every sign-in except an explicit device-only one requests one service-auth
permission for the Jam coordinator. With it, the coordinator verifies the
account's identity and keeps two things for it in PostgreSQL: the personal
queue with its playback position, and appearance and playback settings. Neither
depends on the account's PDS supporting Spaces. Text scale is stored as an
integer percentage. A settings write merges a patch on the server.

Jams use creator-owned Spaces; their prototype and browser acceptance cases are
tracked in [#2303](https://github.com/zzstoatzz/plyr.fm/issues/2303).

## Player navigation

Playback stays above the route stack. On phone-width web the dock and Now
Playing are one surface that stays mounted: tapping or dragging the dock opens
it, the URL moves to `/now-playing` once it has settled, and Back, Close,
Escape or a pull down closes it. A link inside it changes the page first and
the sheet then leaves. On wide web `/now-playing` is a full-screen modal route
with large artwork beside the controls.

Native keeps a local React Native Modal and hardware-Back handling and never
pushes the web-only route. Native exports validate bundles, not gestures.
The iOS player requires the [pinned native audio patch](patches/README.md);
changing it requires rebuilding the native app.

Browser regressions for the player are the `check-player-*` scripts, run after
`npm run build:web`. They use real fixture audio and block real API and PDS
mutations.

## Creator portal catalog state

The portal reads published tracks and albums for the signed-in owner. Visited
tabs retain their loaded cursor pages and scroll context; ordinary Back does
not refetch them. Confirmed track, list, or profile writes in this client mark
only that owner's corresponding catalog scope dirty. Returning to an active
dirty panel revalidates its loaded cursor chain without clearing visible rows;
a failed refresh keeps those rows available for retry.

Changes made elsewhere, and writes still waiting for indexing, use the explicit
refresh control. This is published-catalog management, not a private catalog
or a client-side substitute for server search, filtering, or sorting.

Track uploads and edits accept creator tags, one per line. Intentional changes
follow the published track lexicon: up to 20 tags, each at most 50 UTF-8 bytes
(not the legacy Python validator's code-point count). Tags are lowercased,
whitespace collapsed, and edge spaces/hyphens removed; null characters are
rejected. See the [Lexicon string specification](https://atproto.com/specs/lexicon#string).
An untouched tag field preserves the original record, including absent tags;
clearing edited tags writes an explicit empty array. Operator account labels
never populate creator tags.

The track editor can replace public, open audio with a PDS blob up to 100 MiB,
keeping the existing record URI. Effective access is checked before upload and
publication; protected sources and restricted download policies are refused.
Revision conflicts require reload, and uncertain responses are reconciled before
another save. Keep the original file: Next does not provide replacement history
or rollback. Large-file and protected replacements remain separate work.
Run `node scripts/check-audio-replacement.cjs` after exporting the web client.

Track and playlist creates retain a device-local recovery entry, scoped to the
account, before sending the exact record and client-generated TID to the PDS.
Reloading checks that same address; an explicit retry reuses its key and record.
An accepted create remains accessible until dismissed. A different existing
record is never overwritten and can be explicitly kept. Recovery stores record
metadata and blob references, never credentials or media bytes. Clearing local
app data removes these entries; recovery does not transfer between devices.
An unresolved attempt can be explicitly set aside after a warning that it may
still appear and starting again could create a duplicate. This allows a new
intentional creation without erasing the earlier address or immutable record.
Earlier attempts remain available for read-only status checks and explicit
recovery; resuming never submits automatically. Late acceptance preserves the
set-aside state. Validation and authorization errors never discard an attempt.

## Private music

`/private` reads and creates tracks directly in the owner's existing
`privateMedia/self` space after explicit OAuth consent. The initial path accepts
up to 100 MiB and preserves existing membership; invited members can read and
download. Public policies and app-restricted spaces are rejected rather than
changed. It does not yet manage members, supporter/download rules, transcoding,
or large private uploads.

Private playback uses the existing player and a device-local queue. Private
references are excluded from personal queue synchronization, Jams, public
appview requests and play accounting. Account or session replacement clears
private playback. Recovery stores the exact private record metadata and blob
reference on this device before canonical creation, reuses its TID on explicit
retry, and never overwrites a different record. Clearing app data removes this
recovery state.

The supported ZDS contract is release 0.9.0 (`ebb84af`): `repo.uploadBlob` stages
bytes; `sync.getBlob` exposes them only when a public repository record references
the CID (`src/atproto/sync.zig`, `src/storage/store.zig:blobMetadata`). Space blob
reads require authorized access and a reference in that space
(`src/atproto/space.zig:getBlob`). The upstream store regression covers staged,
private-only and shared public references. Byte-identical audio already published
by the same owner remains public; uploading it privately does not retract it.
This is source evidence, not a new live-service privacy acceptance claim.

`node scripts/check-private-publishing.cjs` exercises synthetic OAuth/PDS writes,
lost-response recovery, current-SDK signed playback, public/private handoff and
session replacement with real external mutations blocked. Set `PRIVATE_SCALE=1.4`
for enlarged-text checks and `PLAYER_DIST` for an isolated web export.

### private deletion and remaining editing gap

Owners can explicitly delete the current private track at its URI. Confirmation
covers intervening edits: this is not a conditional delete of the displayed CID.
After sending once, the client checks the authoritative record. An ambiguous
response permits read-only checks before another explicit attempt, never an
automatic repeat. Finish any creation recovery for the same URI before deleting,
so an unresolved creation cannot be resumed accidentally. Confirmed removal stops
that current audio source, releases it, and removes every occurrence from the
local private queue; other tracks remain paused.

Conflict-safe private metadata/tag editing remains required and unimplemented.
ZDS v0.9.0/default branch `ebb84af92d75d7a531c7ba7a321989e491ff4690`
(`src/atproto/space.zig:635,735`, `src/storage/store.zig:376,5056`) has no
expected-CID/revision parameter for Space putRecord, deleteRecord or applyWrites.
Its transaction serializes unconditional writes; it does not prevent stale
updates. Upstream atproto permissioned-data branch
`79271658633bdc4768c52a7a45ea54771677dd64` likewise defines no condition in
`lexicons/com/atproto/space/putRecord.json` or `deleteRecord.json`.
Editing needs an upstream atomic conditional-write contract plus discoverable
support, or another protocol-supported concurrency mechanism. Reading before a
write and sending an ignored public-repo swapRecord field are not substitutes.

## Large public uploads

Large public uploads require explicit service-storage consent and the separate
upload service-auth permission. Existing sessions can keep listening and using
the small PDS-blob path; sign in again only when large-upload permission is
needed. Audio above 100 MiB and up to 1.5 GiB uses the service's public/open
`audioUrl` path, with sequential 10 MiB reads on web and native. This does not
complete protected uploads, restricted downloads or transcoding parity.

Pause stops transfer work without pretending to cancel an accepted request.
Reselect the original file to resume; every server-reserved digest is checked
before sending new parts. Device-local recovery retains the original upload ID,
record URI and prepared metadata, never credentials or media bytes. Publication
reuses the same canonical create attempt and activates only after authoritative
record verification. Setting a create aside retains completed-upload recovery.
Completed cancellation conflicts remain visible and quota-bearing; published
URLs remain public. Clearing local app data loses this client's recovery list.

`check-large-upload.cjs` uses small file/HTTP/PDS fixtures and logical size
metadata for the consent boundary. `check-large-upload-stream.mts` defaults to a
small loopback streaming fixture; its 1.5 GiB mode runs only in cloud CI. The
cloud receipt proves client chunking/recovery against a synthetic HTTP sink,
not deployed R2 capacity or real-account OAuth acceptance.

## Public downloads

Track options offers downloads for verified `open` and `ask` preferences when
fresh effective access and playback still allow public listening. An existing
artist support link may be offered before an `ask` download; support is optional.
Unknown policies remain unavailable. A protected Space source additionally
requires sign-in and an explicit permitted policy on its freshly verified
record. Missing/off policy, an unverified support gate, and private
visibility refuse download even when playback is readable. Protected bytes use
the same 100 MiB limit and temporary-file cleanup; account changes cancel the
attempt. Private titles and descriptions never replace public metadata.

Browsers save small cross-origin audio with a 100 MiB buffering limit. Published
Next audio-service URLs use its attachment endpoint without that limit. Other
large or non-CORS sources need a direct-download service contract. iOS downloads
to a temporary file and opens the system save/share sheet, then removes the
cache file when the sheet finishes. Rebuild the native app after installing the
Expo Sharing dependency. Public-byte URLs remain public; this UI does not revoke
existing copies or implement owner policy editing.

Processed Next audio offers a choice of playback audio or the retained original
upload. Raw uploads keep one download action. Choices require the published
service manifest and refresh effective access before saving; a missing or invalid
manifest does not authorize an original download.

Supporter downloads require the dedicated download-check OAuth grant. Existing
sessions reconnect explicitly; Jam or upload permission does not imply this
grant. The coordinator's 30-second decision binds the authenticated viewer to
the current canonical public track CID and `supporters` policy. The client then
refreshes effective moderation and playback, and checks the decision again
immediately before bytes start. Expiry does not interrupt a transfer already
admitted; cancellation and account/RPC changes still stop app-controlled requests.
An attachment already handed to the browser uses its download controls. Protected sources also
require their own credential, signed record, and allowed policy. A known `any`
support gate is accepted only with the current supporter decision.

Owner-only/unknown gates, private Space-only records, and legacy gated playback
without an accessible source remain unsupported. A public `open` record cannot
use the supporter endpoint to override a protected `supporters` policy. A 403
does not distinguish identity, policy, or supporter denial. See the
[coordinator contract](../backend/docs/download-policy.md) for its proof and
verifier requirements; this client never infers supporter status from read access.

`node scripts/check-downloads.cjs` checks real browser save events and exact
fixture bytes, fresh-policy refusal, optional support, cancellation and track
navigation. Set `DOWNLOAD_SCALE=1.4` for enlarged text and `PLAYER_DIST` for a
local export. The native save path also requires a rebuilt simulator/device check.
