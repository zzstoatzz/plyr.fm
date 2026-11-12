# Next daily-driver checkpoint

Continuation of the [November 12 handoff](2026-11-12-next-handoff.md).
The [bounded MVP goal](../plans/2026-11-12-next-daily-driver.md) defines the
finish line. This is execution evidence, not another parity inventory.

## shipped to Next

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
  release was made. Signed response verification upgrades remain a separate slice.
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
Production was not promoted. No user records or moderation labels were written
to establish this evidence.

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

Publishing remains a substantial gap: production supports 1.5 GiB uploads,
staging/transcoding, protected audio and explicit storage fallback consent.
Next's public blob path is capped at 100 MiB by the published blob contract.
Raising a UI limit alone cannot provide parity. A compatible large-file path
needs service-owned byte staging and recoverable artifacts while the client
continues creating the canonical record. Collection management and existing
access/download policies also remain required.

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
