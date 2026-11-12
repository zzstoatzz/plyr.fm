# Next daily-driver checkpoint

Continuation of the [November 12 handoff](2026-11-12-next-handoff.md).
The [bounded MVP goal](../plans/2026-11-12-next-daily-driver.md) defines the
finish line. This is execution evidence, not another parity inventory.

## shipped to Next

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

## remaining acceptance

Real-account OAuth, fresh service-auth consent and cross-device account behavior
still need acceptance beyond fixtures. Native simulator playback is evidence for
the RN path, not physical-device lock-screen controls, App Store readiness or
replacement of the existing iOS app. The discovery settings client also passed
native custom-tag normalization, show-all/default restoration and Home navigation;
server enforcement has separate acceptance.
Native remote next/previous remains unimplemented: the current single-player
`expo-audio@58.0.11` path does not expose those controls. That needs implementation,
not just another smoke test. Physical interruptions, audio-route changes and
lock-screen interaction still need device acceptance.

Publishing remains a substantial gap: production supports 1.5 GiB uploads,
staging/transcoding, protected audio and explicit storage fallback consent.
Next's public blob path is capped at 100 MiB by the published blob contract.
Raising a UI limit alone cannot provide parity. A compatible large-file path
needs service-owned byte staging and recoverable artifacts while the client
continues creating the canonical record. Ambiguous create transport recovery,
collection management and existing access/download policies also remain required.

Backend measurements belong in [perf.md](../../next/backend/docs/perf.md), with
dataset, cache state and limits. A workstation median is not a production SLO.
The [November 12 cost snapshot](../../COSTS.md#november-12-daily-driver-cost-checkpoint)
identifies $16.79/month of Next Fly/R2 estimates, excluding Postgres and other
coverage gaps. The combined identified footprint is at least $58.28; retiring
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
