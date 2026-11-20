# Next daily-driver checkpoint

Continuation of the [November 12 handoff](2026-11-12-next-handoff.md).
The [bounded MVP goal](../plans/2026-11-12-next-daily-driver.md) defines the
finish line. This is execution evidence, not another parity inventory.

## shipped to Next

- #2537 at `d1ca5c5e` adds public downloads after refreshing effective access,
  verified preference and playback URI/CID. `ask` offers optional support;
  unknown, off, supporter and protected cases fail closed. Deployment
  `43246370787` passed all eight published phone/desktop, light/dark and enlarged
  fixture cases with exact saved bytes. Rebuilt iOS simulator More → Download →
  Save to Files saved 16,044 fixture bytes and cleared its temporary directory.
  Native distribution, physical devices, Android runtime and protected downloads
  remain unverified. Public files and saved copies cannot be revoked by changing
  an application preference.
- #2533 at `d64d734f` adds durable processing generation/lease ownership, source
  plus output reservation, fenced callbacks, retained originals and published-only
  rendition/original/manifest routes. Next Zig `43247143541`, audio Worker
  `43247143610` and staging `43247143557` deployments passed with processing
  disabled. Legacy staging integration `43247585011` subsequently passed 22 suite
  tests and one large-FLAC capacity test; it is not Next processing acceptance.
- #2540 at `71c7ec3f` prepares the client transport/model for processing state,
  recipe/budget binding and verified MP3 metadata without adding an upload option
  or enabling processing. Web deployment `43249433383` passed. #2543 at `adac109b`
  adds cloud-only processing acceptance to the existing disposable fixture;
  audio deployment `43250849296` passed. Its 23 local checks include actual small
  MP3 encode/decode, original hashing, manifests, ranges and safe failure retention.
  Configured cloud processing has not run: failure/metadata dependencies,
  reviewed staging wiring, small acceptance and then full-size processing proof
  remain required. The raw 1.5 GiB transfer below does not establish transcoding.
- #2517: the public/open large-upload client ships at `48f2bd50`. Existing
  service-owned multipart bytes retain client-owned canonical publication and
  exact-key recovery. Manual deployed acceptance `43237788036` passed the actual
  client status decoder, signed activation, GET/HEAD/Range and exact record/object
  cleanup; four deployed browser cases passed. This small fixture does not prove
  full-size throughput, real-account OAuth consent or native distribution.
- #2528 fixed the activation 503: Workers rejects `redirect: "error"` before
  making a request. Manual redirect handling now rejects non-success responses
  without forwarding credentials. #2530 at `0187aa0d` adds `?download=1` attachment
  responses on published media. Deployed fixture `43238924547` verified plain
  playback bytes, attachment HEAD/206 Range and exact cleanup. #2532 at `1880d6aa`
  exposes `Content-Disposition` through CORS; deployment `43240468687` and a
  read-only cross-origin missing-object HEAD verified the live header policy.
- #2529 at `de99e71f` projects verified track download preferences without
  treating a public playback URL as download authorization. Historical catalog
  reconciliation `43239042552` finished with 461 verified, one absent, 16 retryable
  and two rejected outcomes; its temporary machine was cleaned up. One repository
  failed the official signature verifier with a fresh DID key; the second
  rejection's exact reason was unavailable after log retention. Complete backfill
  remains unproven with one signature rejection and one unclassified rejection;
  the public download client shipped separately in #2537 and refuses unknown data.
- #2526 at `555c6adf` adds the staged processing executor with execution disabled.
  It is a prerequisite, not an enabled end-to-end upload/transcode path. Durable
  ownership subsequently shipped disabled in #2533; configured integration and
  deployed processing acceptance remain open.
- #2531 at `61897fea` adds cloud-only full-size acceptance using the actual
  client transport, bounded generated WAV chunks, a deliberately lost part
  acknowledgement, resume and streamed download SHA-256 verification. The single
  1.5 GiB run `43241857625` failed with a part 409 and cancellation 409, before
  completion/publication. Exact record/object cleanup ran, but upload cancellation
  failed and the artifact reports possible retained 1,610,612,736-byte quota.
  The error body was masked by the fixture's allowlist, so the cause remains
  unclassified. Exact-reservation read-only status confirmed `transferring`, 69
  acknowledged parts and the full reserved quota. #2536 reproduces old recovery
  alarm contention and adds bounded owner-operation waiting; deployment
  `43243794512` passed at `0c06dd1d`.
  #2535 then resumed the same reservation at `4770cc1e`: run `43244675993` passed
  with Worker `76840722-6055-4073-8710-6b18b601afab`, 1,610,612,736 bytes and 154
  parts, reusing 69 acknowledged parts. The streamed download SHA-256 was
  `06db7cf0de3224738c2140e1354156c811bb784c7b2aea642d9b9d0007e57d11`.
  Maximum generated read was 10,485,760 bytes; peak runner RSS was 191,934,464
  bytes. Signed activation, attachment HEAD/Range and browser CORS headers passed.
  Cleanup confirmed completed/published, no retained quota and no cleanup failure.
  The first run injected the lost part-two acknowledgement; this recovery run
  injected no new loss. This proves one cloud full-size transfer and same-ID
  recovery, not sustained throughput, native memory bounds or real-account OAuth.
- #2525: owners can delete private tracks with explicit confirmation that the
  current record, including changes made elsewhere, will be removed. Missing
  grants and incompatible policies prevent writes; unresolved creation blocks
  deletion so recovery cannot recreate it. Lost responses reconcile through
  readback, with Check as the only action while the outcome is unknown.
  Confirmed absence removes every matching private queue occurrence, releases
  current audio and leaves remaining tracks paused and playable. Deployment
  `43233021408` serves `b3e84923`; eight deployed normal/enlarged browser cases
  passed. Native simulator recovery verified exactly one synthetic delete and
  one source release, using a local-file protected-source adapter. This does not
  establish native signed transport or real-account OAuth. Private metadata
  editing remains open: current ZDS `ebb84af9` and permissioned-data lexicons
  `79271658` lack atomic revision preconditions.
- #2522: private creation/recovery and playback use the owner's existing private
  space and the app's existing player. Policy checks preserve invited members;
  public-like/list-write boundaries, accounting and queue sync reject private
  references. Deployment `43230579868` serves `29c8a84a`; four deployed fixture
  cases verify consent, lost-response recovery, signed record verification,
  public/private handoff, session replacement and policy denial. The previously
  unguarded mini-player Like action and late player callbacks fail negative
  controls. Native MMKV checks and playback/handoff passed, with a local-file
  protected-source adapter: this does not prove native signed transport or real
  private streaming/cache disposal. No real account writes or native release.
- #2519: artists can replace public/open audio up to 100 MiB while preserving
  the record URI, labels and unknown fields. Canonical and effective access
  checks run before upload/publication; CAS conflicts retain the draft and lost
  responses reconcile the exact candidate. Deployment `43229921357` serves
  `f291ff077`; all eight deployed normal/enlarged browser cases passed. Native
  menu entry and same-DID session replacement work, and coordinate Save produced
  one synthetic blob upload and one CAS update. Measured native scrolling is
  correctly bounded; CUA delivered touch-down without movement, so physical
  scrolling and VoiceOver remain unverified. An entry-dependent accessibility
  snapshot omission was not reproduced as hidden or unhittable native controls.
- #2518: artists can create albums and add, remove or reorder track occurrences
  using canonical list records. New references are checked against the owner's
  PDS; existing duplicate/unavailable entries and unknown fields survive edits.
  Lost responses reconcile the same record key, and accepted contents drive
  playback while projection catches up. Returning from creation refreshes the
  artist's album list. Deployment `43226900658` serves `4ff9ce2d`; eight deployed
  fixture cases passed across phone/desktop, light/dark and enlarged text, with
  conflict/reload controls visibly reachable. Native simulator creation,
  organizing and playback also passed. These used synthetic PDS records, not
  real account writes or native distribution.
- #2512: current Spaces responses use `accept-signature`, signed record/commit
  headers and key-share-bound verification, with no legacy proof fallback.
  Python and the vendored SDK verify canonical bytes and CID bindings; the SDK
  crypto path also passed on native Hermes. Next web `43224000461`, staging
  `43224000377` and deployed private-media E2E `43224000344` all succeeded at
  `0580d72c`. The fixture checks do not establish real-account Next OAuth or new
  permission consent. Production was not promoted.
- #2515: owners can reorder playlist occurrences with explicit Save/Cancel.
  Canonical snapshots and compare-and-swap preserve duplicate references,
  unavailable entries and unknown fields; ambiguous responses reconcile the
  same candidate before another write. Accepted order drives playback while the
  appview catches up, including saves completed behind Settings, skipped
  intermediate revisions and account/route changes. Deployment `43219891155`
  serves `eb8b7dd9`; eight deployed normal/enlarged browser cases passed and
  screenshots were inspected. Actual iOS simulator move/save/Play/Next/pause
  passed. The missing action and retained-screen busy bug each failed their
  pre-fix checks. Album creation/organization remains separate work.
- #2511 and #2514: current Spaces requests use `credentialKey` and the batch
  `putMembers`/`removeMembers` methods. The prior field and singular methods
  were removed by ZDS; staging telemetry identified the membership failure as
  `404 UnknownMethod`, rather than a browser CORS configuration defect. Private
  sharing and Next Jam invitations preserve read-only grants. Python and actual
  Next invitation regressions fail on the old requests. Deployment `43219109965`
  serves Next web `58d9a8f2`; staging deployment `43219110147` and real private-media
  E2E `43219110198` passed. The latter verified outsider refusal, an owner grant,
  member audio 206, removal returning to 404, fresh-session private playback and
  private voice recording, with disposable tracks deleted afterward. No production
  release was made. Signed response verification subsequently shipped in #2512.
- #2510: an owner can explicitly set aside an uncertain or permanently rejected
  create, with a warning that it may still appear. Its exact intent remains in
  earlier attempts for checking or resuming. Resolving an earlier attempt
  preserves an unrelated fresh upload draft; dismissing the current upload
  resets only its own form. Native MMKV verified the archive/late-accept races;
  eight deployed recovery cases passed after deployment `43215102495` of
  `6fc762c5`. Both the original missing action and the draft-loss bug failed
  their corresponding pre-fix browser checks.
- #2505: upload and playlist creates persist their exact payload and record key
  before sending. Lost responses reconcile that address; retries cannot invent
  a duplicate key or overwrite a different record. Late responses do not restore
  dismissed operations. Deployed `5859cb8a` passed 16 recovery/upload/Library
  browser cases. Actual iOS Hermes/MMKV checks verified account isolation,
  duplicate-key rejection, accepted-CID persistence and delete/late-accept behavior.
  Recovery lives on the device; it does not transfer across devices or survive
  clearing application storage.
- #2508: native next/previous commands reach the existing queue through a pinned
  Expo Audio patch. The same OS command fails on the unpatched native build and
  succeeds on the rebuilt patched binary. Radio suspension clears the controls;
  returning to personal playback restores them. Web deployment `43212966349`
  and deployed phone/desktop player-navigation checks passed. Installed iOS
  acceptance is separate from web deployment and does not constitute distribution.
- #2509: collection reads cannot continue into a write after account/RPC
  replacement. The editor resets with its owning session, and late accepted
  writes cannot redirect the replacement editor. The old client reproduced an
  unwanted write after a held read; the fix passed all four collection mutations
  across different-account and same-account replacement. Four normal and four
  enlarged-text layouts, existing Library checks, and four deployed layouts
  passed. Deployment `43213682157` serves `efe43094`.
- #2504: the existing API machine stays warm in `sjc`, avoiding an observed
  2.225-second first request after automatic shutdown. Deployment
  `43210186456` passed; both existing API/ingester machines run `19053e66`,
  with the API's minimum running count verified as one. Public readiness and
  a 24-track catalog read returned 200 in 202 and 342 ms respectively. These
  are individual network-inclusive observations, not latency percentiles.
  The estimated incremental compute cost is $1.60–2/month; no replica was
  added. See [performance evidence](../../next/backend/docs/perf.md#first-visit-startup-november-12)
  and [cost assumptions](../../COSTS.md#november-12-warm-api-floor).
- #2490: prepared composed reads, usable artist sections and collection playback,
  clearer Search, consistent Home pagination and repaired browser checks.
- #2491: Library playlist creation stays reachable; accepted creates remain
  accepted while indexing catches up, with draft/account isolation.
- #2492: upload drafts and completions belong to the submitting session; account
  changes during blob upload cannot publish through the replacement account.
  The existing 100 MiB limit is visible before file selection.
- #2493: composed reads retry once after a confirmed broken connection, after
  unwinding the result and replacing the connection. Writes, SQL errors and
  timeouts are not replayed. Disposable PostgreSQL fault injection established
  recovery; the old binary failed the same first-request check.
- #2494: Portal has one heading, a direct public-profile link, primary upload and
  quieter edit/share actions. Tabs retain pagination, refresh and Back behavior.
- #2496: native startup no longer calls the browser-only pagehide listener.
  An actual iOS simulator build played public audio, retained playback through
  navigation/backgrounding and paused/resumed correctly.
- #2497: profile edits survive failures and distinguish accepted writes from a
  failed refresh. Same-account reauthentication also isolates pending work.
- #2499: signing in from the profile editor replaces the retained route, so its
  native modal no longer covers login. Simulator and deployed browser checks
  verify the visible login and preserved return destination.
- #2501: uploads also isolate same-account reauthentication. A late accepted
  write cannot replace the fresh form, and signing in preserves `/upload`.
- #2498 and #2502: discovery applies creator tags and separate account AI labels
  before pagination, with explicit opt-out and filter-bound cursors. Historical
  labels replay into a rebuildable table; expiration and negation are honored.
  Live multirow verification caught borrowed PostgreSQL label strings; the shared
  decoder now copies them into request-owned memory, backed by both a deterministic
  buffer-reuse regression and a 50-row HTTP test.
- #2495: Settings exposes account-scoped hidden tags, explicit show-all and default
  restoration. Home resets its cursor when the filter changes, retains it for a
  no-op settings sync and removes hidden tag suggestions. Real guest browser checks
  on phone/light and desktop/dark exercised default → show-all → default against
  the live API and rendered Penny's tracks only with opt-out. Four deployed fixture
  layouts separately cover custom input, validation and account isolation.
- #2503: creators can supply tags on upload and edit their canonical tags. The
  editor reads the current PDS revision, preserves untouched tags and unknown
  fields, and uses compare-and-swap. A real stale-revision fixture keeps failing
  until the user explicitly discards the draft and reloads; the later save keeps
  the newer unknown fields. Explicit clearing writes `[]`; untouched absence
  stays absent. Published limits are UTF-8 byte limits, distinct from the legacy
  Python character limit. Four editor and four upload layouts, plus both phone
  themes at 140% text, passed against the deployed bundle with fixture PDS writes.

These changes passed their scoped local checks, review, CI and Next deployment
checks. UI matrices covered phone/desktop, light/dark and enlarged text. Signed-in
browser checks used mounted components with fixture identities and mocked PDS
boundaries; they do not establish real OAuth or authorize user-record writes.
Production was not promoted. Live upload acceptance uses the existing disposable
integration account with exact fixture record/object cleanup; no real-user
records or moderation labels were written to establish this evidence.

## profile links and account labels

Bluesky's [profile links announcement](https://bsky.social/about/blog/10-22-2026-introducing-profile-links)
and social-app source at `44a037a63575c800955eeb9e0a1024e7b2e4c063`
(`src/features/profileLinks/`) informed the portal: destinations should be
direct, identifiable and inspectable. Bluesky owns separate link records and
ordered profile references. Plyr's published profile lexicon does not have that
contract; the portal cleanup does not invent one. Existing support links are
legacy service-owned preferences. Richer editable links remain a separate change.

Penny's existing account label was verified through the public labeler:
`penny.hailey.at` resolves to `did:plc:m4247k3y7qpbpw5opune7nvf`; its active
`ai` assertion comes from `did:plc:xnk7t5cvnnvzkmbf7wpss527`, dated October 23.
The [existing policy](../internal/moderation/label-policy.md) applies the label
where the listener hides `ai`, while preserving artist and direct access.
An operator account assertion must remain separate from creator track tags.
After deployment at `2d705ce1`, default latest returned no Penny tracks in its
first 50; explicit show-all returned 14 with intact `["ai"]` account labels, and
her artist page returned three of three with the same labels. Those three public
reads took 351/238/166 ms end to end, with cache warmth unknown; this is acceptance
evidence, not a warm regional latency measurement or SLO.

## remaining acceptance

Real-account OAuth, fresh service-auth consent and cross-device account behavior
still need acceptance beyond fixtures. Native simulator playback is evidence for
the RN path, not physical-device lock-screen controls, App Store readiness or
replacement of the existing iOS app. The discovery settings client also passed
native custom-tag normalization, show-all/default restoration and Home navigation;
server enforcement has separate acceptance.
Native iOS next/previous uses a pinned `expo-audio@58.0.11` patch that emits
commands from Expo's existing remote-command owner to the app queue. Simulator
OS commands verified next, previous/restart and return to the prior track;
radio handoff cleared personal metadata and command handlers. These checks used
an inspected MediaRemote sender through LLDB, not lock-screen button presses.
Physical interruptions, audio-route changes, lock-screen/headset interaction and
authenticated native Jam/remote-output transitions still need device acceptance.
Download-preference editing (#2539) and original-file download client (#2544)
remain pending their native/dependency gates; they are not shipped acceptance.

Publishing remains a substantial gap: production supports 1.5 GiB uploads,
staging/transcoding, protected audio and explicit storage fallback consent.
Next's public blob path is capped at 100 MiB by the published blob contract.
Private creation and public audio replacement share that cap. #2507/#2517 now
provide public/open service-owned multipart staging with client canonical writes;
small deployed acceptance passes after #2528, and the same-ID full-size recovery
passed in `43244675993`. The earlier failed fixture
`43230541415` completed exact record/object cleanup but may retain one 4,044-byte
recovery reservation; the separate 1.5 GiB reservation released its quota after
successful recovery. Large and protected replacements, enabled transcoding,
access/download-policy management,
historical download-policy backfill and protected/original download acceptance
remain open. Public download acceptance is recorded under #2537 above.
Private metadata editing also
requires conditional-write support absent from the current Spaces API; a
preliminary read is not an atomic revision check.

Backend measurements belong in [perf.md](../../next/backend/docs/perf.md), with
dataset, cache state and limits. A workstation median is not a production SLO.
The [November 12 cost snapshot](../../COSTS.md#november-12-daily-driver-cost-checkpoint)
identifies $16.79/month of Next Fly/R2 estimates, excluding Postgres and other
coverage gaps. The combined identified estimate is $58.28, still incomplete; retiring
legacy API traffic alone does not retire its worker responsibilities. Cheaper
overall operation has not yet been established.

## documentation at cutover

Keep the published guides describing the application users actually receive.
Update these together with the corresponding release, after each flow is proved:

| Source | Required change and acceptance |
| --- | --- |
| `docs/public/listeners.md` | New sign-in, Home/Search, Now Playing, queue, Library and settings paths; distinguish implemented continuation from For You and scrobbling gaps. Verify keyboard and native differences. |
| `docs/public/artists.md` | Portal/profile and publishing steps; prove large files, processing, edits, replace/delete, collections, protected/download policies, export and offboarding before retaining their promises. |
| `docs/public/moderation.md`, `sensitive-content.md` | Match account-label filtering, content notices and ownership exceptions to actual surfaces. Do not imply the temporary implementation changes policy. |
| `docs/public/troubleshooting.md`, `glossary.md` | Replace legacy recovery/navigation instructions; document accepted writes awaiting projection without suggesting duplicate uploads. |
| `docs/public/developers/` and API reference | Version legacy and Next contracts explicitly; client-owned writes, service-auth state and opaque IDs are not a hostname substitution. Keep unsupported Subsonic/SDK surfaces identified. |
| `docs/public/legal/`, internal deployment/auth/storage/offboarding docs | Reconcile actual data ownership, retention, service URLs and recovery/rollback procedures against the cutover implementation. |
| `next/README.md`, `next/app/README.md`, `COSTS.md` | Keep native verification/release limits and operational commands current; capture the actual combined footprint and retirement savings. |

Existing screenshot assets are in `docs/site/public/screenshots/`. Replace
`login-page.png`, `landing-page.png`, `search-overlay.png` and
`feed-track-card.png` with the listener guide; replace `upload-form.png`,
`portal-track-editor.png` and `portal-dashboard.png` with the artist guide.
`track-actions-menu.png` currently has no public-guide reference: either reuse
it deliberately or remove it when refreshing the set. Add Now Playing, Library
and discovery settings images only where the instructions benefit. Update alt
text with the steps, use non-sensitive fixtures and inspect both phone and
desktop results. Temporary acceptance screenshots are not automatically public
documentation assets. Build the docs and check links after replacing the set.
