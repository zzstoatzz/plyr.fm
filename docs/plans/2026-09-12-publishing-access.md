# proposal: publishing defaults and per-work access

Date: 2026-09-12. Status: approved; implementation and staging smoke goal active.

Nate explicitly prefers deliberate breakage over compatibility layers. Measure
the affected catalog and client paths, document contract changes, and use one
current model. Data migration to preserve restricted audiences is still required;
obsolete API shapes and behavior do not need indefinite compatibility shims.

## goal

An artist configures how people may listen and obtain files in Portal. Uploads
use those defaults, albums can apply shared settings, and individual tracks can
override them. Maya's case is ordinary: anyone may listen, downloads are off,
and rights information is optional. Storage capability must not redefine those
choices. This revises the UX and semantics of #2047, not its completed smoke status.

## current conflicts

The decision history is in `docs/internal/architecture/audio-access-reconciliation.md`.
Inspection of the current implementation confirms:

- `VisibilityPicker.svelte` mixes discovery, audience and a separate download
  selector. Its copyright restriction hides otherwise independent choices.
- `write_track_rights` in `_internal/copyright.py` changes audience, storage and
  distribution records when adding rights. Removing rights can publish bytes.
- `utilities/downloads.py` refuses all listener downloads whenever a support gate
  exists, even for a listener who satisfies that gate and the download policy.
- Missing track download overrides dynamically inherit artist preferences.
  Changing the preference does not migrate bytes that were published publicly.
- Native-private visibility also hides metadata and interactions. A public album
  sold to purchasers cannot be represented by reusing that visibility unchanged.
- Albums have no policy. Current native access checks are artist-scoped; they
  cannot represent different entitlements for different works merely by relabeling.

## proposed artist experience

Portal has a “music access” section with defaults for new uploads:

- [x] anyone can listen
- [x] anyone can download
- [ ] attach rights information

New accounts start with the first two checked. Existing choices are preserved.
Copyright is not a yes/no ownership question; the third control configures
optional credits, rights and licensing information using the existing paradigm.

Unchecking listening or downloading reveals a small “who can?” choice: only me,
or a supported audience. Offer verified supporters where actually configured;
offer a specific Space where its authority supplies access. Do not display
purchase amounts or subscription tiers before a verifier can enforce them.
Signed-in listeners remains available to represent the existing copyright audience.
Support prompts are optional presentation under downloads, never a paid-access gate.

An ordinary upload shows only:

> anyone can listen · downloads allowed
>
> using your Portal defaults · change for this track

Expansion shows the same controls as Portal, plus optional discovery settings.
“Show in feeds” describes today's public/unlisted distinction accurately; do not
call it link-only because unlisted tracks remain searchable and on profiles.
Metadata privacy is a separate advanced choice, with authority-enforced private
works retaining today's hidden metadata behavior. Do not add three more primary
controls to every upload. A one-time dismissible notice links to Portal without
blocking upload or requiring rights setup.

Album upload shows the shared access summary once. Tracks have a collapsed
override. Album editing offers “apply to tracks using album settings”, shows the
affected count and exceptions, and requires an explicit choice to replace exceptions.
Downloading an album never bypasses an individual track's authorization.

## semantics and defaults

Keep explicit listening permission, download permission, metadata exposure and
rights metadata separate from source location. Resolve them in one backend access
module used by response capabilities, playback, downloads and archive creation.
Retain existing storage adapters; do not build a general-purpose policy engine.

For a new work, precedence is track override, then album settings, then Portal
defaults. At publication, persist the resolved policy and its origin. Portal
changes affect future uploads. Album policy changes are explicit batch edits,
not unbounded runtime inheritance. An existing track changes through the same
validated operation whether edited alone or with an album. This revises the earlier
suggestion of live track → album → Portal inheritance: live inheritance is unsafe
when a changed choice needs a storage transition or changes an audience.

Listening and downloads are independent actions. A person may buy a file without
having a streaming subscription. Hiding a work's metadata, however, remains an
outer access boundary; downloads must not reveal a work to an unauthorized viewer.
Moderation decisions remain authoritative and separate from artist rights metadata.

Playback necessarily delivers audio bytes. “Downloads off” controls the supplied
file download, not recording or saving playback. For protected new uploads,
prepare a separate playback rendition before exposing playback; the uploaded
master must not temporarily serve as the public stream. This closes a limitation
in #2047 instead of claiming private R2 alone protects the original.

## storage now and Spaces later

Public distribution can use public PDS blobs and existing public R2 delivery.
Restricted originals or listening use protected storage. For the currently
implemented managed policies, that is private R2. Existing native-private works
continue to use their Space authority; an authority refusal must never trigger
an R2 fallback or a read using the artist's credential.

The upstream [permissioned-data proposal](https://github.com/bluesky-social/proposals/blob/main/0016-permissioned-data/README.md)
defines credentials for read access to a Space and allows authority decisions
based on user and client. It does not define a playback-only permission or a
commerce entitlement protocol, and remains a draft.

Consequently, our design requires separate protection for masters and playback
when their audiences differ. One Space admitting free listeners to the master
would defeat a purchaser-only download policy. A future implementation may use
separate Spaces or an explicitly authorized playback service. The exact mapping
requires validating the reference implementation; the artist's choices need not
depend on which mapping works. Do not represent managed storage as a fake Space.

Spaces capability detection alone never migrates data. An artist-requested
migration must establish the target authority and grants, copy and verify every
required asset, test permitted and refused reads, then change references. Preserve
the old protected source for rollback until verification completes. Authority
failure after cutover must fail closed, not silently serve the rollback copy.
Migration must preserve metadata exposure and each action's audience, not merely
the word “private”. Public copies already distributed cannot be recalled.

## implementation phases

1. Normalize current behavior without broadening access. Add explicit policy and
   policy-origin fields to track/album models and publishing defaults to preferences.
   Backfill legacy copyright to signed-in listening and downloads off; supporters
   to their current listener/download behavior; native-private to its authority.
   Snapshot existing effective download settings, including auto support prompts.
   Update `api/preferences.py`, `api/tracks/uploads.py` and upload sessions to use
   one resolver. Centralize playback/download decisions and response capabilities.
2. Separate rights writes/removal from access and storage in `_internal/copyright.py`
   and `api/tracks/copyright.py`. Route deliberate policy edits through a validated
   transition that prepares assets before publishing the new policy. Remove obsolete
   client contracts deliberately and document the break; do not add compatibility
   branches or silently reinterpret old writes.
3. Replace the picker with the compact shared controls in Portal, upload, record
   and `TrackEditForm.svelte`; add album batch application in `api/albums/mutations.py`
   and album UI. Preserve per-track exceptions and expose effective summaries.
4. Review and smoke-test the complete lifecycle on staging before promotion.
   Implementing purchases, new commerce verifiers and automatic Spaces migration
   is outside this change. Leave extension points at entitlement evaluation and
   storage selection, not a speculative checkout UI.

## dispassionate review

The proposal is larger than hiding a select. That cost is justified by the actual
coupling of rights, gates and storage. A smaller visual patch would conceal it.
The main sprawl risk is inventing a universal policy language or implementing future
commerce. Concrete action permissions and existing verifier adapters bound that risk.

Checkboxes cannot fully express restricted audiences. Progressive disclosure is
necessary, and unchecked must always display its effective audience. Preserving
legacy signed-in behavior adds an advanced option; deleting it would silently
broaden or narrow existing access. Defaults are publishing templates, not a global
catalog switch; that distinction needs explicit Portal copy.

R2-to-Spaces is not merely swapping a backend: source grants, per-work boundaries,
metadata addressing and service authorization differ. The proposal promises stable
product semantics, not an already-implemented migration. It also must not describe
new protected settings as revoking historical public copies.

## acceptance evidence

### initial blast-radius inventory (September 12)

Read-only aggregate queries against `plyr-prd` and `plyr-stg`; no data changed.
GitHub repository access, Fly staging status and Cloudflare Pages listing succeeded.

Production has 1,064 tracks: 1,016 public, 41 unlisted, four supporter-gated
tracks from two artists, and three native-private tracks from one artist.
There are no copyright gates and no explicit per-track download overrides.
Storage totals are 783 R2, 276 both, and five PDS-only. Artist counts across
storage groups overlap and must not be summed.

Among preferences belonging to artists with tracks, 78 artists/870 tracks use
automatic open downloads, 24 artists/178 tracks use automatic support prompts,
one artist/five tracks uses off, one artist/five tracks uses supporters, and one
artist/one track each uses explicit ask and open. Four tracks have no matching
preferences row. These counts describe defaults, not proof of private bytes.
Gate refusal takes precedence over the old download defaults; the track migration
must preserve that refusal rather than only copying the preference.

Staging has 96 tracks: 91 public, one unlisted, one supporter-gated and three
native-private. It has no copyright-gated or explicit `r2_private` fixtures.
Therefore live smoke must create protected-upload and rights-metadata cases;
passing against the existing staging catalog cannot verify those cases.

Intentional breaks to inventory as implementation proceeds: old upload policy
fields, rights endpoints' gate side effects, runtime preference inheritance,
support-gate record shapes, and clients consuming these fields. No evidence yet
establishes the number of external API consumers. Catalog counts are not client
usage counts. Production remains undeployed.

### required checks

Local implementation evidence so far: publishing policy/default persistence tests
pass (29 targeted cases). Rights write/clear now preserve gate, storage, URL and
download settings; the rights suites pass 22 cases. The upload parser no longer
creates a gate from rights metadata. The rights response drops `is_copyright_gated`;
frontend consumers still need updating as part of the new contract.

Protected managed uploads now prepare a distinct MP3 before record publication,
including when the uploaded master is already web-playable. Nine regression
cases failed before the fix; 72 optimization/cleanup/replacement cases pass after
it. A failed or identical-output encode refuses publication rather than serving
the master. This deliberately makes protected publication wait for encoding;
ordinary public uploads retain deferred optimization. These are local tests,
not completed staging playback verification.

Uploads now accept a single `publishing` JSON form field. Unknown form fields
are rejected, so an old private upload request cannot silently become public.
The resolver uses Portal, album and track templates and saves download policy
and origin on the track. Download endpoints and album ZIP authorization no longer
read live artist download defaults. The old preference field is removed in the
migration and API, rather than kept as an ignored compatibility setting.

The local database migration test rebuilds the previous table shape and runs the
actual Alembic upgrade. It verifies explicit overrides, inherited defaults,
supporter discovery normalization, copyright-to-signed-in conversion, private-R2
source tagging for old gated audio, and unchanged native Space storage. Public
sources remain tagged public even when download policy is restrictive. That test
and policy/preferences tests pass 30 cases. Existing endpoint fixtures and UI
clients still need conversion to the new contract; the full-suite run identifies
remaining mismatches. Automatic downgrade is refused because old live defaults
cannot represent the new per-work policies without losing access decisions.

- Maya: anonymous playback, original download refused, owner recovery works;
  adding/removing rights changes none of those decisions.
- Legacy copyright, supporters and Space tracks retain their previous audiences
  after migration; support status alone never grants a Space read.
- New Portal defaults, album application, explicit overrides and removal of an
  override behave consistently; changing Portal does not mutate published works.
- Test each action independently, including downloads without streaming access,
  mixed-policy albums, moderation refusal and expired/revoked entitlements.
- Original protection holds during processing, replacement, revision restore,
  PDS saves, signed URLs, Subsonic and cached ZIP downloads. Public-copy limitations
  are surfaced when editing previously public content.
- Run backend/frontend checks and actual authenticated staging uploads, owner,
  anonymous and unauthorized reads, and mobile/desktop light/dark UI review.
  The existing staging authentication blocker is unresolved; earlier redirect
  checks do not count as completed authenticated smoke tests.

### frontend integration checkpoint

Portal, single-upload and record forms use shared PublishingControls and the
collapsed PublishingSettings summary. The old VisibilityPicker is removed.
Drafts preserve the complete settings across sign-in and Space consent; uploads
wait for preferences to load. Album uploads submit the new contract, but their
shared controls and per-track overrides still need implementation, as do the
existing-track and album-edit policy endpoints/UI and the one-time introduction.

Frontend type checking and lint pass; the preexisting 240 tests pass. New policy
parser and Storybook interactions were added; visual verification remains pending.
The broad backend run found 38 failures, with 1,666 passes and 25 existing skips.
It exposes fixtures/contracts still tied to live defaults and legacy upload
fields; all failures must be reviewed and resolved before opening the PR.

## local stack checkpoint (2026-09-12)

Running the actual frontend (:5173), FastAPI (:8001), Docket worker, Rust
transcoder (:8082), isolated Postgres (:5544), Redis (:6390), and a local
S3 emulator (:9010). Disposable local owner/session and catalog fixtures;
no production credentials or data. R2's adapter is exercised against the
emulator, so this is not evidence about Cloudflare delivery. The fixture
session deliberately has no real PDS credentials.

Browser evidence so far:
- Portal saved public listening/downloads off, then upload inherited it.
- Expanding, overriding, and resetting a track restored the Portal setting.
- A FLAC upload traversed resumable transfer, worker, storage and real MP3
  transcoding; publication then failed at the missing PDS credential boundary.
  No track row survived the failed publication.
- That failure exposed a missing terminal SSE error callback. Fixed it so the
  form retains its title/file and shows an inline error, without a stuck
  "finishing up" indicator. The two regression cases pass with the fix and
  fail when the callback forwarding is removed.
- Existing-track policy change created protected playback and retained its
  master, then returned the editor to Portal. A failed change kept the editor
  open and the previous access in the database.
- Album application preserved an explicit track override; selecting replacement
  updated both tracks and their saved origins through the real Docket worker.
- Phone (390px) album controls checked in light and dark. Found and corrected
  insufficient space between the apply button and its result text. Remaining
  surfaces and desktop/theme matrix still need inspection.

Review findings fixed during this pass: unchanged album titles are no longer
submitted by the track editor (avoids unintended album reassignment); saved
policy origins get distinct copy from a new custom override; managed protected
tracks are excluded from the public-PDS migration banner and modal; Subsonic
uses its authenticated session for protected playback rather than a blanket
refusal. Native Space authority still goes through the existing audio endpoint.

Validation checkpoints: 1,716 backend tests passed, 25 existing skips; then 34
focused publishing/Subsonic/catalog tests passed after follow-up changes.
Frontend typecheck passed; two new upload-error regressions passed. Final whole
suite, lint, self-review, PR, deployed staging UI and authenticated staging
lifecycle smoke remain outstanding. These local fixtures do not prove successful
PDS publication, native Spaces, supporter-provider authorization, or staging.

### Local browser continuation

The running local stack uses the real FastAPI app, worker, frontend and Rust/ffmpeg
transcoder with isolated Postgres/Redis and an S3 emulator. It does not prove real
R2 permissions, PDS publication, native Spaces, or external supporter verification.

Browser evidence from the signed-in disposable artist:
- Portal saves owner-only listening defaults; both new-track and new-album forms
  show the saved audience on navigation. Existing album tracks retain their policy.
- Album upload changes propagate into inherited entries. A track download override
  changes its summary to custom settings; reset restores album defaults.
- Existing album application completes with two updated tracks. Earlier checks
  preserved a track exception unless the replace-overrides option was selected.
- Portal no longer offers public-PDS migration for protected tracks. Its storage
  description now explains that restricted audio uses protected storage.
- Album save feedback was inspected at 390px and 1280px in light theme; Portal
  access controls at both widths in dark theme; album-upload template and entry
  overrides at 390px in dark theme. Remaining matrix cells are still pending.
- Corrected collisions between album settings and the track section, and between
  track settings and the remove button. Re-inspected both at 390px: deliberate
  gaps now separate them, with aligned card gutters and wrapping summaries.

Final-review corrections include invalidating discovery and album caches when
rights work fails after access has committed. Such jobs remain failed and must be
reviewed before retrying; access and remote rights records are not one transaction.
Removed the unused `previously_public` extra flag; source revisions retain history.
The client update is prepared locally with 51 passing interface tests; separate
permission to publish/merge it has been requested. No redesign PR or deployment
has occurred yet, and authenticated staging verification remains outstanding.

### Signed-out playback regression

The local browser selected a protected FLAC original because the shared player
preferred browser-playable lossless sources. This returned 403 for anonymous
listeners even though the work allowed public listening. Protected tracks now
select the playback rendition and bypass previously cached file URLs so current
server authorization runs. The regression fails without the rendition-selection
fix. Retest after signing out: browser requested the MP3 rendition (307), decoded
the two-second audio with readyState 4 and no media error, and recorded a listen
(200). Anonymous original and download requests remained 403. Local telemetry
proxy 500s reflect the deliberately disabled Logfire setup, not playback failures.

### Portal load failure review

Profile saving now requires both the artist profile and publishing defaults to
load successfully. A failed preferences read previously left the initial public
policy available to save; the form now disables saving and offers a retry. The
component regression fails against the previous source and passes with the guard.
Frontend validation: 248 tests across 45 files; typecheck and lint pass.

Local browser checks also saved public listening with downloads off and inspected
the Portal controls at 390px in dark and light themes and 1280px in light theme.
The expanded discovery controls, save button and following share-links section
have distinct spacing and align with their parent form. These remain local
checks, not evidence of staging deployment or real R2 permissions.

Recording review: expose the existing rights checkbox in the recording preview
for artists with the copyright feature enabled, matching uploads. This lets a
recording opt out of inherited rights attachment without changing Portal.
Desktop dark Portal controls also inspected at 1280px; the form, disclosure,
save button and following section have distinct spacing. Recording preview
still needs browser verification with a test microphone.
