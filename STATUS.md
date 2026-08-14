# plyr.fm - status

## long-term vision

### the problem

today's music streaming is fundamentally broken:
- spotify and apple music trap your data in proprietary silos
- artists pay distribution fees and streaming cuts to multiple gatekeepers
- listeners can't own their music collections - they rent them
- switching platforms means losing everything: playlists, play history, social connections

### the atproto solution

plyr.fm is built on the AT Protocol (the protocol powering Bluesky) and enables:
- **portable identity**: your music collection, playlists, and listening history belong to you, stored in your personal data server (PDS)
- **decentralized distribution**: artists publish directly to the network without platform gatekeepers
- **interoperable data**: any client can read your music records - you're not locked into plyr.fm
- **authentic social**: artist profiles are real ATProto identities with verifiable handles (@artist.bsky.social)

### the dream state

plyr.fm should become:

1. **for artists**: the easiest way to publish music to the decentralized web
   - upload once, available everywhere in the ATProto network
   - direct connection to listeners without platform intermediaries
   - real ownership of audience relationships

2. **for listeners**: a streaming platform where you actually own your data
   - your collection lives in your PDS, playable by any ATProto music client
   - switch between plyr.fm and other clients freely - your data travels with you
   - share tracks as native ATProto posts to Bluesky

3. **for developers**: a reference implementation showing how to build on ATProto
   - open source end-to-end example of ATProto integration
   - demonstrates OAuth, record creation, federation patterns
   - proves decentralized music streaming is viable

---

**started**: October 28, 2025 (first commit: `454e9bc` - relay MVP with ATProto authentication)

---

## recent work

### August 2026

#### albums download as cached zips, and the track page learned to be touched (#1834–#1839, August 14 — prod `2026.0814.034855`)

**why**: with track downloads a day old, the natural next ask (nate, after
brooke's mobile review) was albums — "download as a zip? or whatever is
best/safest/canonical" — plus the mobile half of the redesigned track page
had pointer-sized controls, and the album-download progress toast read like
prose.

**what shipped**:
- **`GET /albums/{handle}/{slug}/download`** (#1836): eligible when *every*
  member track passes the same shared policy (`download_refusal` +
  `download_key` — one policy, now three consumers). a cache hit 307s to a
  zip in R2 (attachment disposition baked at upload; the CDN carries the
  bytes — nothing transits the app VM hardened the same night); a miss
  enqueues a worker build reusing the export machinery. entries are
  `NN artist - title.ext` in the album's ATProto-list order (ordering
  extracted from `get_album` into a shared `order_album_tracks`), the zip is
  ZIP_STORED (audio doesn't compress), and the destination key encodes a
  digest of the ordered member keys so album edits naturally invalidate —
  the worker sweeps stale digests when publishing. frontend: a download icon
  beside share when `tracks.every(downloadable)`, following the job's SSE.
  verified end-to-end on staging *and* prod (downloaded
  `incognitothief - bike lane.zip`, integrity-checked, confirmed the 307
  cache hit).
- **mobile controls clear the 44px touch-target floor** (#1834): the
  regrouped track page's controls were pointer-sized on phones (heart ~32px,
  queue ~34px). every control now pads to ≥44px with proportionally larger
  glyphs, play grows to 56px on mobile, and the disc gained press feedback
  (`:active` scale, the footer player's existing convention). the richer
  material treatment was prototyped and deliberately reverted — the design
  system has no elevation tokens, so it would have been a one-page
  snowflake; #1835 tracks doing it holistically.
- **a `toast-copy` skill, applied** (#1837–#1839): the cold-build toast said
  `packaging... — you can keep browsing, it stays ready once built` on
  every update. researched toast/snackbar norms and captured them as
  `.claude/skills/toast-copy` (outcome not mechanics, ≤10 words,
  reassurance said once, one persistent toast per flow, honest errors);
  the flow now runs `preparing album — takes a minute, safe to leave` →
  `gathering tracks (2/12)…` → `album ready`. settings copy caught up
  (the toggle governs albums now, not just tracks) and docs.plyr.fm gained
  downloads sections for listeners and artists (#1839).

**technical notes**: two concurrent first-clicks can enqueue duplicate zip
builds — idempotent writes to the same key, so the cost is wasted worker
time; accepted and noted in #1836. the generated API reference was left
alone (#1680: regeneration isn't reproducible; hand-editing drifts). local
dev footgun found while verifying: a 10-day-old orphaned vite held port
5199, silently winning the bind race against every fresh dev server —
checks against "the local frontend" were actually hitting whatever env that
old process had baked.

#### an album batch wedged the app VM — the memory was in a library default (#1831, #1832, August 14 — prod `2026.0814.024347`)

**why**: at 02:02 UTC the primary app machine went completely silent mid-upload
— no logs, health check timing out, SSH unschedulable — while an artist
batch-uploaded an album of WAVs. fly-proxy autostarted the standby 35 seconds
later; clients saw "upload timed out (stopped at 100%)" on 7 of 8 tracks.
Logfire showed **zero errors**, because requests that die before the app leave
no spans — the durable signals were fly machine states and the traffic shape.

**what shipped**: `upload_fileobj` now runs with an explicit `TransferConfig`.
the killer was not uploader concurrency but aioboto3's reader-side
`io_queue`, which eagerly buffers full 8MB parts with a default maxsize of
**100 — up to ~800MB per upload** on a 1GB VM idling with ~330MB free. the
first fix (#1831) capped only `max_concurrency` and was **insufficient**;
careful re-review found the queue by reading the installed source, and #1832
capped it (`max_io_queue=2`, ~32MB per upload). the whole-file sync scans
(sha256, duration, ALAC detection) also moved off the event loop, so `/health`
keeps answering under upload load. verified via the staging integration
suite's 150MB longform-WAV upload — the incident shape — then released with a
clean window (449 requests, zero 5xx). full retro:
[`docs/internal/runbooks/2026-08-14-upload-memory-wedge.md`](docs/internal/runbooks/2026-08-14-upload-memory-wedge.md).

**technical notes**: #1389's end-to-end streaming held — the memory hid in a
transfer-library default nothing in our code named. mocked tests can't
validate a kwarg's runtime effect, which is how the insufficient first fix
passed everything. still open, recorded in the retro: machine-level health
alerting (fly knew at 02:02:19; a user report told us), app-VM sizing, and
the 2×-file-size /tmp exposure at the 1.5GB upload cap.

#### tracks are downloadable, and the detail page got its sketch (#1824–#1826, August 13 — prod `2026.0813.195021`)

**why**: a community member asked (via signal) for downloads to support a
community event. the agreed shape: downloadable by default for anything that
isn't gated or copyright-labeled — the bytes are already served
unauthenticated by the artist's own PDS — with an artist opt-out. mid-review,
nate and brooke redrew the track detail page in a notebook, so the surface the
download button landed on got restructured in the same arc.

**what shipped**:
- **`GET /audio/{file_id}/download`** (#1824) 307s to a presigned public-bucket
  URL whose signed `response-content-disposition` names the file
  `artist - title.ext` (RFC 6266, UTF-8 `filename*`) — the stored object and
  the streaming path are untouched. prefers the preserved lossless original;
  verified on prod by downloading `incognitothief - bold.wav`, the 16-bit
  original, not the mp3 rendition.
- **one policy module, two consumers**: `utilities/downloads.py` owns
  `download_refusal()` (private / gated / copyright / artist opt-out) and
  `download_key()` (which object, if any, we actually hold). the endpoint and
  the new `TrackResponse.downloadable` both derive from it, so the UI can
  never offer what the endpoint would refuse — the button simply doesn't
  render. the artist's `allow_downloads` preference (new column, default on)
  reaches track responses through a selectin-loaded one-to-one
  `Artist.preferences` relationship: one batched query per artist load, no
  N+1.
- **the track detail page matches nate's sketch** (#1826): identity (title,
  artist), tags, one controls line — like chip (the existing
  like/add-to-playlist menu trigger with its count) · filled circular play ·
  bare queue icon — then `N listens`, then an unboxed share/download pair.
  gaps are `clamp()`ed to the viewport and the play disc is rem-sized;
  the queue and utility icons are quiet borderless glyphs like the player's
  own transport controls, scoped to this page so the bordered 32px form
  survives on dense surfaces.

**technical notes**:
- **policy keys on the copyright *label*, never raw scan flags** — the same
  decided-state rule discovery, radio, and streaming already follow (#1697):
  a fingerprint match is a pending review, not a finding. adversarial review
  of the first implementation found (a) downloads would have 307'd to a
  presigned URL for a key that names nothing (PDS-only rows, unmirrored
  ingested rows — the #1811 family), handing listeners a NoSuchKey XML file
  while the UI offered the button, and (b) the scan-flag check read an
  arbitrary row of an append-only table. both died in the consolidation:
  `download_key` refuses what we don't hold, and scan flags left the policy.
- **a circular import crashed the staging app at boot** (#1825): schemas →
  utilities.downloads → storage.keys runs `storage/__init__` → r2.py, which
  imported `content_disposition` back out of the still-initializing module.
  only uvicorn's entrypoint order hits it — the test suite and a pre-merge
  import check both touched `backend.storage` first and masked it.
  `content_disposition` moved into r2.py (its only consumer), and a
  regression test now imports `backend.main` in a fresh interpreter, the way
  uvicorn does.
- **gated tracks never download**, even for supporters or the artist —
  "pay to download" is a deliberate later extension. PDS-only tracks 404
  rather than redirect to `getBlob`, which cannot carry a filename
  disposition. deferred: per-track toggles, download counts.

#### the media hosts never had a CORS policy at all (#1821, August 10 — infra, no release)

**why**: [@chris.pardy.family asked for CORS headers to build a web DJ deck on
plyr](https://bsky.app/profile/chris.pardy.family). The API has allowed any
HTTPS origin since #1106, so the request read as already-satisfied — but audio
bytes never come from the API. `r2_url` points at an R2 custom domain, and R2
CORS is configured per-bucket, entirely separately from the FastAPI middleware.
All four public buckets returned *"The CORS configuration does not exist"*
(code 10059): preflight `403`, and a `GET` that returned `206` with real bytes
and no `Access-Control-Allow-Origin`. Playback through `<audio src>` worked, so
nothing ever surfaced the gap.

**what shipped**:
- `infrastructure/r2/cors.json` — `GET`/`HEAD` from any origin, `Range`
  allowed, range-relevant headers exposed — applied to `audio-{staging,prod}`
  and `images-{staging,prod}`, with a README recording the apply command, the
  propagation lag, the purge step, and which buckets must never receive it.
- **this closes #1753**: the artwork accent wash was inert in production for
  exactly this reason. Canvas sampling of `images.plyr.fm` no longer taints,
  so `/radio` should pick up its accent without a frontend change.

**technical notes**:
- CORS is a browser policy about whether *JS on another origin* may read a
  response, not authentication — which is what made `*` safe to reason about
  rather than merely convenient. The public buckets are already reachable two
  ways with no auth (active custom domain *and* an enabled `pub-*.r2.dev` URL);
  the pre-change `curl` returned the full audio. `*` grants browsers a read
  that any server-side script already had.
- `audio-private-{staging,prod}` are deliberately excluded and the README says
  why: no custom domain, `r2.dev` public access disabled, presigned-URL only.
  `*` there *would* be an access-control change.
- No credential surface: R2 returns literal `*`, so browsers refuse
  credentialed cross-origin requests; independently, no `set_cookie` in the
  backend passes `domain=`, so `session_id` is host-only and is never sent to
  the media hosts. Listing is not exposed either — `/`, `/audio/`, and
  `?list-type=2` all 404, and keys are content hashes.
- **The bucket policy alone was not enough.** The media domains carry a 1yr
  edge TTL, so already-cached objects kept serving their header-less variant
  and `Vary: Origin` did not rescue them — fresh fetches carried the header
  while `cf-cache-status: HIT` did not. Purged by *host* rather than
  `purge_everything`, so only the two media hostnames refill and the frontend's
  cache was left alone. Propagation also lags: preflight went `403` → `204`
  before the `GET` header appeared.
- Verified as the user-facing capability, not as headers: headless Chromium on
  a genuinely foreign origin read `24343244` bytes via `fetch`, decoded them
  (`2ch 44100Hz 138.00s`), and pulled `6085800` raw PCM samples — plus
  `getImageData` on an untainted canvas for cover art. The `curl` proof was
  taken against a cached `HIT`, since that is the path real listeners hit.
- The purge token was minted from `THANOS_TOKEN` scoped to one permission group
  (`Cache Purge`) on one zone with a 2h expiry, then revoked.

**not addressed, flagged so it isn't mistaken for new**: `mirror_pds_blob`
re-hosts firehose-ingested audio on our CDN because a record was published, not
because the artist asked. Those blobs are already public and unauthenticated at
the source PDS, so CORS changes nothing about it — but the consent question is
real and independent.

#### `just backend test` and CI pointed at different databases (#1815 → #1818, August 9)

**why**: CI runs `pytest tests/ -n auto` against service containers with
`DATABASE_URL` pinned to localhost. `just backend test` ran serially and never
set `DATABASE_URL`, so conftest derived its base URL from
`settings.database.url` → `backend/.env` → **neon dev**. The recipe started the
compose postgres, waited for it, ignored it, and ran `create_all` +
`_truncate_tables` (plus `CREATE DATABASE` under xdist) against a real cloud
database. The two commands did not merely differ in speed.

**what shipped**: `just backend test` is now `-n auto` with `DATABASE_URL` and
`DOCKET_URL` pinned at the compose services, mirroring `test-backend.yml`.
`just backend test-serial` keeps a one-process path for pdb — `-n0` rather than
`-p no:xdist`, which would remove the `worker_id` fixture conftest depends on.
`DOCKET_URL` was already protected by pyproject's `D:` prefix; `DATABASE_URL`
had no equivalent.

#### plyr publishes a `community.lexicon.app.profile` record (#1817, August 9)

**why**: app directories and stores read a self-published description of the
app — name, icon, links, and the lexicons it produces and consumes. Keyed
`self` in our own repo.

**what shipped**: the icon is uploaded as an atproto blob rather than
referenced by URL, so the record survives reshuffling
`frontend/static/icons/`. Every claim was verified against source rather than
assumed: `produces` lists the collections we actually write (including the two
teal scrobble records), `consumes` lists `app.bsky.actor.profile`, and all six
link URLs return 200. The dev and staging namespace variants are deliberately
omitted — they are not a published surface.

#### a track row's `file_id` is not a storage key (#1805–#1811, August 9 — prod `2026.0809.065939`, `.181741`, `.210022`)

**why**: an artist asked why ten of their tracks weren't on their PDS. Nine were
the known #1565 token-rotation herd, fixed in June and never repaired
afterwards. The tenth failed on July 6 for reasons that no longer exist
anywhere: PDS-blob upload is best-effort, so the failure degraded to R2-only
with a warning log, and by August the telemetry had aged out. Repairing them
through the portal then failed on *four* tracks with `image must be hosted on
allowed origins`, and a later batch of eighteen reported "11 saved, 1 skipped,
6 failed" with an empty error list and nothing in Logfire at all.

**what shipped**:
- **the origin allowlist left the record write path** (#1805). It was added in
  November 2025 as ingest defense — don't let a tampered record point plyr's UI
  at hostile artwork — but it lived in `build_track_record`, so it also policed
  what plyr wrote to a creator's *own* repo, and it was computed from the
  *current* `R2_PUBLIC_IMAGE_BUCKET_URL`, so plyr's own pre-`images.plyr.fm`
  URLs failed it. Ingest-side trust (`origin_trust.py`) is unchanged: hostile
  record edits still never render. Deciding where a creator's artwork may live
  was never ours to enforce at authorship.
- **failures are now visible to the person they happened to** (#1806, #1810):
  upload results carry a structured `pds_blob_failed` flag, and the warning
  toast is sticky with a `save to your PDS` action deep-linking to
  `/portal/manage?save=pds`, which opens the picker directly rather than
  dropping the caller at the top of a long page.
- **the portal states the truth when there's nothing to do** (#1807, #1808):
  an affirmative "all your audio is on your PDS" card replaces a button whose
  modal would be empty; a dismissible banner (dismissal stored per-account in
  `ui_settings`, never localStorage) surfaces the standing case; share links
  show 5 before "load more" instead of 20.
- **the actual bug** (#1811): `Track.file_id` addresses storage only for
  uploads that came through us. On the jetstream ingest path it is
  `record["fileId"]` falling back to the rkey — author-supplied, as #1778's own
  commit message says — while the bytes live under the content hash in
  `r2_url`. Eight sites passed a track row's `file_id` straight into storage:
  batch and single-track PDS save, **track delete and account deletion (which
  silently orphaned the real object)**, media export (which silently omitted
  the track), the file-sizes endpoint, and revision restore + prune. All now
  resolve through `AudioKey.for_track(file_id, file_type, r2_url)`.
- an operator alert (`pds blob mirroring failures`, discord, 15m/1h) fires on
  `pds blob upload failed` / `pds save failed for track` in production.

**technical notes**:
- The six "missing" staging objects returned **206** at the key in their
  `r2_url` and 404 at the key derived from `file_id`. Playback never noticed
  because it redirects straight to `r2_url` and never derives a key — which is
  exactly why this survived so long. The same asymmetry holds on three real
  production rows belonging to external users (`natespilman.at`,
  `pat-ou.bsky.social`, `bifftar.selfhosted.social`), i.e. precisely the people
  writing plyr records from outside our UI.
- `storage/keys.py` already existed to make save/read extension drift
  unrepresentable (#1413). It worked: the key *type* was right everywhere. This
  was the next mutation of that family — correct type, wrong identifier — so
  the invariant is now pinned on the source itself: a test scans `src/backend`
  and fails on any `storage.{head_file,stream_file_data,delete,get_url}` keyed
  by `track.file_id` / `track_data["file_id"]` / `revision.file_id`. It caught
  `revisions.py` while the PR description was being written.
- `AudioKey.from_url` requires the URL's origin to match *this deployment's*
  bucket. A path lifted off a foreign origin would otherwise name one of our
  objects while claiming to describe someone else's bytes — the #1778 hazard,
  one layer down.
- `save_one` had four early returns doing `failed_count += 1; return` with no
  log and no recorded reason, which is why querying Logfire for a batch that
  had just failed six times returned zero rows. Every failure now routes
  through one helper that records a reason and groups by cause; a bare
  `failed_count += 1` no longer exists in the module.
- The blob mirror in the *other* direction already exists and was not the
  problem: #1778's `mirror_pds_blob` fetches a PDS-hosted blob, verifies it
  hashes to the record's `pds_blob_cid`, and stores our own copy — so a record
  authored by any client with an `audioBlob` becomes fully playable here.

#### the parallel test-database bootstrap ran inside a per-test timeout (#1809, August 9)

**why**: CI failed with ~30 setup errors reading `relation "artists" does not
exist`. Not flakiness — run the way CI runs it (`-n auto`), the suite failed
**5 out of 5** local attempts with 124–218 errors.

**what shipped**: the xdist template database is now built in `pytest_configure`
on the controller — before any worker or test timeout exists — and bootstrap
completion is marked with postgres's `datistemplate` flag, so a build
interrupted between `CREATE DATABASE` and `create_all` is rebuilt rather than
cloned schemaless by every worker. The local test redis runs `--databases 128`;
each worker claims db `1 + gwN` against a default of 16, which a many-core
machine exceeds at gw15.

**technical notes**: the failure mode was a queue of workers waiting on
`pg_advisory_lock` inside the first test's 10s `pytest-timeout` budget (1456
timeout hits across four workers in the failing run). A waiter timing out
poisons its worker; a *creator* timing out leaves a permanently schemaless
template. Verified that the finalization marker alone does **not** fix the
cascade — the controller move is the load-bearing half.

#### search ranks lexical intent above trigram fuzz (#1523 → #1801, August 9 — prod `2026.0809.034121`)

**why**: typing "you don't kn" into add-tracks ranked the exact-prefix title
"you don’t know the shape i’m in (mj lenderman cover)" fourth, below three
short titles that merely shared trigrams — the #1523 report, finally with its
mechanism pinned. Relevance was bare `similarity()`, which divides shared
trigrams by the *union* of both strings' trigram sets, so a long title is
structurally punished against a short query no matter how exactly it matches;
the `ilike` substring check only qualified candidates and contributed nothing
to rank. Control experiments sharpened it: querying with the title's exact
curly apostrophe still ranked it fourth, and the no-apostrophe variant dropped
it entirely.

**what shipped** (#1801): all five search helpers (tracks, artists, albums,
tags, playlists) share one tiered relevance — exact match, then prefix, then
substring, then trigram fuzz — with `word_similarity()` breaking ties within a
tier, because it scores the query against the best-matching *segment* of the
target rather than the whole string, undiluted by target length. Curly and
straight quotes are normalized on both sides (Python `str.translate` for the
query, SQL `translate()` for the column), so all three query spellings
converge. The trigram qualifier stays, so typo recall ("lendermann") is
unchanged. Verified on prod: the reported title now ranks first for all three
spellings (3.92 vs the old winners' 0.46). Regression tests are seeded with
the reported titles and were proven failing on the old ranking.

**technical notes**: local validation was contaminated for hours by a
concurrent Codex worktree session — docker compose derives its project name
from the directory (`tests`), so *every* checkout of this repo shares the same
`tests-test-db-1`/`tests-test-redis-1` containers, and the other session's
older-branch conftest kept recreating tables with stale schemas under this
one. Every "stale schema" ghost of the evening (artists without `pds_url`,
three-column `albums`, FKs to missing columns) was that collision, not docker
flakiness. Final validation ran against throwaway containers on unique ports;
CI was the clean signal throughout.

#### exclude is curation, not removal — the runbook that found two gaps (#1797, #1799, August 8–9 — prod `2026.0809.003905`, `2026.0809.025829`)

**why**: a user report (via @vicwalker.dev.br) flagged an account whose catalog is
spoken prayer recordings, with the most-played airing on radio. The intended
remedy already existed — the `override_exclude` paradigm from #1699/#1700 — but
checking it before applying it, and then applying it, each surfaced a defect.

**what shipped**:
- **radio and the atlas honor `exclude`** (#1797). `load_corpus` filtered on
  labels only — it predates the override projection (#1525 vs #1700) — so the
  transparency headline "removed a track from discovery and radio" was false for
  radio, the surface the report was about. The atlas eligibility SQL replicated
  the same gap.
- **`exclude` applies only in LIST contexts** (#1799). It used to apply in every
  `LabelContext`, so recording the six exclusions blanked the artist's public
  profile to "no tracks" for about an hour — a curation decision presented as a
  takedown. It now lives in the LIST branch next to the adult-preference clause:
  feeds, search, radio, and the atlas exclude; destinations (artist page, album,
  permalink) always show the full catalogue, the same principle #1709
  established for labels. The album card count moved with the album page so
  they cannot disagree. Removal outright remains `takedown`'s job.
- **six `override_exclude` events recorded** (ids 41–46) against the reported
  account's tracks, actor-attributed and reasoned. Verified end-to-end in prod:
  projection landed on all six rows, radio rotation contains none of them, the
  profile lists all six, permalinks return 200.
- **no transparency-post flood**: `override_exclude` is a *published* action and
  the publisher posts per event, so six events meant six posts. Posting was
  paused for the recording window, the publisher observed-and-passed the six in
  disabled mode (cursor now beyond them; they will never be auto-announced),
  then posting was re-enabled. A batching implementation — adjacent same-
  (action, reason) events render as one "removed 6 tracks" post — is complete
  with tests and parked on `feat/batched-transparency-posts`, deliberately
  unmerged pending review.

**technical notes**: the test suite itself encoded the wrong semantics
(`test_exclude_override_hides_in_every_context`) — a reminder that a passing
test pins whatever you told it to. The rewritten tests pin the split:
curation empties chosen surfaces, never a navigated-to page.

#### the write-echo alert's first live firing: a true positive, with a recovery gap (#1796, August 8)

**why**: the #1775 blackout alert fired for the first time — one `fm.plyr.list`
write at 20:58 UTC, zero echoes in the hour.

**what happened**: at 20:49 the consumer's blind-host detector rotated it onto
`jetstream2.us-east`; nine minutes later the write went out. The PDS and the
relay both provably held the commit (matching CIDs), and replaying all four
jetstream hosts from a cursor before the write showed three of them serving it
— `jetstream2.us-east` alone never did. An externally verified upstream blind
host, and we had rotated onto it just in time.

**the gap** (#1796): rotation rewinds the cursor a fixed 10 seconds, but a host
blind to *our* collections keeps serving bsky profile traffic, and every such
event advances the cursor. By the time 1800s of own-collection silence
triggered the next rotation (21:50, onto a host that had the event), the cursor
was 52 minutes past it — permanently skipped. No data was lost *this* time
because the write was plyr-originated (the API writes the DB directly; the echo
is confirmation). The real exposure is third-party clients writing `fm.plyr.*`
records straight to a PDS: jetstream is their only ingest path, and the
write-echo alert cannot see their writes at all. Proposed fix in #1796: on
blind-host rotation, rewind to the start of the blind window, not 10s.
The alert re-fired once more before the orphaned write aged out of its 1h
window — expected, and exactly the cost of detection without recovery.

#### the scan was pointed at a host the uploader controls (#1778 → #1790, August 8)

**why**: `Artist.pds_url` comes from a DID document, and for `did:web` that
document is served from the subject's own domain. We interpolated it into a
`getBlob` URL and handed it to AudD, Modal, and Replicate — each of which
fetches it server-side. The regression test on `main` built
`http://169.254.169.254/xrpc/com.atproto.sync.getBlob?...` from a stored
`pds_url` and sent it to three third-party fetchers: the cloud metadata
endpoint, reached by proxy. And a PDS serves blobs *fresh on every request*, so
"scan the track" meant "scan whatever that host returns at that moment".

**what shipped**: `is_safe_url` now runs where an untrusted endpoint enters the
system (`slingshot.resolve_mini_doc`, accepted or rejected whole, so a hostile
PDS also blocks the handle update it arrived with) and at both `pds_blob_url`
construction sites, since rows written earlier can still hold a hostile
endpoint. Then `mirror_pds_blob` fetches the blob once through the hardened
client with a size cap, checks it hashes to the `pds_blob_cid` the record
commits to, and stores our verified copy — the vendor steps re-enter against
bytes we can vouch for. Validation alone would have left the TOCTOU intact plus
a reassuring log line. The object is keyed by the content hash `storage.save`
computes, never by the record's attacker-supplied `fileId`; `content_hash_ownership`
has caused three incidents already. The verification is self-securing: the fetch
targets the PDS slingshot resolved for the DID, so a record naming bytes that
PDS won't serve simply fails to mirror — an unverified jetstream event can cause
a *failed* mirror, never a wrong one.

**scope**: 2 of 1001 prod tracks are `audio_storage='pds'` with no R2 copy, but
that population is the one that grows — 75% of August uploads carry a PDS blob,
up from 3% in December. The scan-integrity half of #1778 is still open (see
known issues); this closes the SSRF half.

#### smaller things, August 8

- **operator alerts say which environment fired** (#1793). Discord notifications
  carried no environment tag, so a staging page and a production page were
  indistinguishable at 2am.
- **the PDS mirror backfill script got a docket client** (#1791), and the attempt
  to ship `scripts/` inside the backend image was reverted the same day (#1792) —
  admin scripts run from a checkout, not from the deployed container.
- **the `DATABASE_POOL_RECYCLE=240` staging mitigation was unset** (#1794): forcing
  a reconnect every 240s starved concurrent uploads behind the 3-per-artist gate
  and timed out three album integration tests. Integration albums are now isolated
  per run, because `_create_album` is idempotent on `(artist_did, slug)` and a
  timed-out run leaves its album behind for the next one to double-count.
- **a transparent favicon for Safari tabs** (#1777).

#### the session cache was handing out PDS credentials (#1778–#1784, August 7–8 — prod `2026.0808.035148`)

**why**: an external security assessment of the atproto projects ranked plyr.fm
highest-risk and led with CSRF on cookie-authenticated mutations. Checked against
source, that headline did not hold — the API is `api.plyr.fm` and the frontend is
`plyr.fm`, so they are same-site, `SameSite=Lax` withholds the cookie from a
cross-site POST, and every mutation is POST/PUT/PATCH/DELETE with no destructive
GET. What the assessment *did* prompt, indirectly, was the right question: not "is
each finding severe" but "what do they compose into". Asking that turned up
something live.

**what shipped**:
- **the session cache no longer holds plaintext credentials** (#1783). `oauth_session_data`
  is Fernet-encrypted in Postgres, and `get_session()` decrypted it and wrote the
  result into Redis as plain JSON for 60s on every miss — keyed by the session id,
  which *is* the bearer token, so a `KEYS plyr:session:*` scan enumerated live
  credentials before reading a value. Now the cache stores the ciphertext already in
  hand, keys on `sha256(session_id)`, and drops the redundant `session_id` field.
- **subsonic `/rest` requires an actual developer token** (#1784). The legacy `p=`
  path resolved its credential with a bare `get_session()`, so any browser cookie
  session authenticated the whole surface; the sibling `u+t+s` path already filtered
  on `is_developer_token`. Both now share one helper. A browser session and a
  developer token are the same opaque string distinguished only by a column, which
  is why the asymmetry survived since #1644.
- **three debug logs stopped printing full session ids** (#1781), matching the
  `[:8]` convention already used elsewhere.

**technical notes**:
- **the DPoP private key was cached in plaintext next to the tokens it protects.**
  This was worse than the original writeup assumed and is the finding most likely to
  generalize to other atproto appviews. DPoP exists so a stolen access token is
  useless without the matching key; caching the key alongside it collapses
  proof-of-possession back to bearer semantics. It is easy to miss because you audit
  for things named `*_token`, and the key rides along in the session blob without
  ever being classified as a credential.
- **verified against the running system, not the diff.** Connected to Redis in both
  environments and asserted on real entries. Production failed every check before the
  release — key contained the raw bearer token, value contained it again,
  `oauth_session` was a plaintext dict with `access_token`, `refresh_token`, and
  `dpop_private_key_pem` — and passed all of them after. A caching change fails
  quietly: an unstable key "works" while never hitting.
- **the regression test caught a bug in the fix.** The first implementation returned
  `None` when a cached payload would not decrypt, which would have turned any OAuth
  key rotation into a mass logout and let anyone with Redis write access force-logout
  arbitrary users. Unreadable entries now evict and fall through to Postgres.
- the transferable parts are written up in
  [`docs/research/2026-08-08-credential-handling-in-atproto-appviews.md`](docs/research/2026-08-08-credential-handling-in-atproto-appviews.md).

**the chain this closed one step of**: `plyr-transcoder` is publicly reachable and
its auth middleware accepts everything when `TRANSCODER_AUTH_TOKEN` is unset (#1780,
latent — the secret is set, and the app is suspended); that endpoint pipes untrusted
bytes into `ffmpeg`; code execution there lands on the Fly private network; where
`plyr-redis` needs no password (#1782); where the decrypted tokens were. Steps four
and five were unconditional and permanent — they hand the same payoff to any future
foothold — which is why the cache was fixed first.

**what followed** (archived — see `.status_history/2026-08.md`): `plyr-redis` now
requires a password (#1786), closing step four of the chain on both environments;
rehearsing that cutover on staging found that `slowapi` hands storage exceptions
to a handler reading `exc.detail`, so an unreachable Redis returned `AttributeError`
on *every* request including `/health` — fixed in #1787 with an in-memory fallback,
verified by restarting staging redis under load (150/150 requests returned 200).

#### August 3 – 8 (archived)

See `.status_history/2026-08.md` for detailed history: redis growing a password and
a redis blip taking the whole API down (#1782, #1786, #1787); the blackout alert
that finally pages someone, after the obvious alert was proven wrong twice (#1775);
the third-party-broadcaster design shape read out of sister-radio's syndication
write-up (#1774); 502 followers and the first full usage accounting; `/atlas`, the
2D semantic map of the catalog (#1766–#1768); the legal codification that public
audio is analyzed and derived data published (#1769); embeds surviving sandboxed
iframes (#1770); counting users from the network instead of the database (#1761);
the sister-radio listener-page adoptions and the two rules they produced
(#1752–#1756); three player bugs with one disease (#1757, #1759, #1762); the radio
switching tracks mid-song by design (#1760); and the pinned tag selection (#1763).

### November 2025 – July 2026

See `.status_history/` for detailed history, one file per month: `2026-07.md`,
`2026-06.md`, `2026-05.md`, `2026-04.md`, `2026-03.md`, `2026-02.md`,
`2026-01.md`, `2025-12.md`, `2025-11.md`.

## priorities

### current focus

**the credential chain, closed one step at a time** (#1778–#1790, August 7–8): an external security assessment led with a CSRF finding that did not survive contact with the source, but asking "what do these compose into" instead of "is each one severe" found a live one — the session cache was writing decrypted OAuth tokens *and the DPoP private key* into an unauthenticated Redis, keyed by the bearer token itself. Four steps of that chain are now closed: the cache holds ciphertext (#1783), `/rest` requires a developer token (#1784), `plyr-redis` requires a password (#1786), and the copyright/genre vendors are no longer pointed at an uploader-controlled endpoint (#1790). Every fix was verified against the running system rather than the diff — connect to Redis, assert on real entries, confirm production failed the check before the release and passed it after. **next in this arc**: the scan-integrity half of #1778 (a `did:web` track's bytes are still served fresh on every request, so a clean scan does not pin what listeners hear) and the transcoder's fail-open auth (#1780), both in known issues; and a habit of auditing what a *blob* contains rather than what a field is named — the DPoP key was never classified as a credential, which is why it rode along for months.

**the catalog has a spatial surface** (#1766–#1768, August 4): `/atlas` is an unlisted pan/zoom map of every public track, positioned by CLAP-embedding similarity, with haiku-named regions, cover art at deep zoom, and click-to-play through the normal footer player. Rebuilt daily by a GitHub Actions workflow into the stats bucket and proxied at `GET /stats/atlas`. The legal pages were updated in the same window to say plainly that public audio is analyzed and that derived data may be published (#1769), with `terms_last_updated` bumped so existing users are re-prompted. **next in this arc**: a live-radio overlay, deep links, on-map search, and the question of whether the atlas should exist as an ATProto artifact rather than only a page — all deliberately out of v1.

**the player's structural problem is now written down** (#1757–#1762, August 3–4, plus `docs/research/2026-08-03-player-architecture.md`): four bugs in two days — a queue eaten by a stale seek handler, a jam left paused, a station on air and silent after a rapid flip, and server-side rotations teleporting mid-song — were all the same shape: work outliving the load it belonged to on one shared `<audio>` element, or a rotation rebuilt underneath a listener. 22 writers to `player.paused` across 4 files, mode as three unrelated flags, coordination by effect ordering. The research note surveys nine mature players (MPD, mpv, ExoPlayer, AVFoundation, vidstack, shaka, hls.js, feishin, jellyfin-web), which converge on single-funnel element ownership, per-load lifecycles, and explicit mode. **next in this arc**: load-session scoping, the first of five proposed adoptions; and any automated coverage at all for jam, which remains the least-exercised mode.

**radio has a live source** (#1741–#1750, July 30–31 — prod `2026.0730.225420`): the `firehose` station airs relay-eval's sonified atproto firehose live over HLS, modelled as *preemption* of the rotation rather than an entry in it — the loop's position is derived from wall-clock time, and an unbounded broadcast inside it would dissolve that. A broadcast carries its own cover and credits its source, a negative liveness report gets a second opinion from the playlist, and the broadcaster is CDN-fronted so 1000 listeners cost its origin ~5 req/s instead of ~255. It then spent a day on air and silent (#1749, #1750): the tune-in path trusted `canPlayType`, which lies in Chrome, and then awaited a module import inside the tap handler, which spends mobile's autoplay permission. **next in this arc**: the station has no recorded fallback while its segments stay unlisted (see known issues); opening preemption to other broadcasters is gated on moderation, since live audio cannot be fingerprinted before it airs — the design shape (advertisement vs. admission, after sister-radio's syndication write-up) is now captured in #1774.

**the firehose promises neither order nor delivery, and bytes need owners** (#1732–#1740, July 30 — prod `2026.0730.072900`, `.181756`): a repo's commit history was re-emitted upstream and ingest applied each replayed state as current, so commits are now ordered by repo `rev`, which survives re-delivery where jetstream's `time_us` cannot; then the same instance stopped delivering `fm.plyr.*` for 11 hours while still serving Bluesky profile events, so the consumer now rotates across twelve hosts and detects a host gone blind on *our* collections specifically. Separately, staged-upload cleanup had been deleting published tracks' audio — a content-hash `file_id` means re-uploading a file you already published stages the exact key it is served from. 20 tracks across 7 artists broken, 13 recovered; playback now falls back to the artist's PDS blob and the refcount covers every media column. **next in this arc**: ~~an alert~~ shipped (#1775, August 7 — the write-echo blackout alert plus a consumer-liveness heartbeat); schedule `audit_media_integrity.py`; give `_MEDIA_REFERENCES` awareness of `r2_url`.

**moderation: from inert labels to recorded decisions** (#1691–#1718, July 24–27 — prod `2026.0725.035625` → `2026.0728.043224`): `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; `LabelContext.LIST` vs `VIEW` keeps labels shaping discovery rather than destinations; and underneath all of it `moderation_events` carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. Published contact is now `help@plyr.fm` / `dmca@plyr.fm`, and rate limits are keyed per client rather than per site (#1716, #1718). August 8–9 sharpened what those decisions *mean*: `override_exclude` is curation, not removal, so it empties chosen surfaces (feeds, search, radio, atlas) and never a destination anyone navigated to (#1799), and radio and the atlas actually honor it now (#1797). **next in this arc**: triage the 18 queued subjects; merge or discard the transparency-post batching work parked on `feat/batched-transparency-posts` (six curation events currently mean six posts); per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves. The DMCA surface itself is still incomplete (see known issues).

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, epic #1384): private audio in an artist-owned permissioned space (never R2), owner-only, credential-gated playback — end-to-end on staging, **in prod but inert** (only ZDS implements this experimental surface). The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**identity, discovery and the queue** (#1620–#1730, July): a broken avatar led to five live artists hidden from every discovery surface because we read one host's `#account` event as a statement about the person — fixed at three levels, and the identity task that maintains the PDS cache is now actually registered with the worker (it had never run in production). The radio no longer plays one artist back-to-back (#1730). An experimental subsonic `/rest` shim lets off-the-shelf clients (Symfonium, Amperfy, Shelv) play plyr libraries with a developer token as the password (#1644–#1651); collection continuity queues the rest of an album or playlist as a labeled "next from" context (#1626); repeat-one shipped (#1653/#1654/#1657), reviving @AilaScott's #1518, with repeat-all deferred until the loop-vs-continuation interaction is designed.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **unlike may leave the track in the liked list** ([#1812](https://github.com/zzstoatzz/plyr.fm/issues/1812)): `test_cross_user_like` failed once against staging on August 9 and has passed since. Filed rather than dismissed as flaky, because the assertion describes a read-your-own-write guarantee. Ruled out: stale cache (the liked list is a direct DB query) and a failed delete (it commits before returning). Untested hypothesis: `unlike_track` deletes the row and backgrounds the PDS deletion, so a replayed like-create event could resurrect it — the #1736 family. Track deletes write a tombstone for exactly this reason; likes may have no equivalent.
- **`just backend test` runs serially, CI runs `-n auto`** ([#1815](https://github.com/zzstoatzz/plyr.fm/issues/1815)): the two take different paths through `conftest.py` — serial uses `_setup_database_direct` with no template database, no advisory lock, and no per-worker redis db. The entire parallel bootstrap only ever executed in CI, which is why #1809's bugs were invisible locally despite failing 5/5 once run CI's way. Distinct from the shared-compose-project issue below, which is about *concurrent* sessions rather than parallel workers.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see.
- **parallel agent sessions share one test database** (found August 9): `backend/tests/docker-compose.yml` has no `name:` field, so compose derives the project name from the directory — every checkout/worktree of this repo maps to the same `tests-test-db-1`/`tests-test-redis-1` containers, and two sessions running tests concurrently silently recreate each other's schemas (see the #1801 technical notes for the evening this cost). A `name:` derived from the checkout path, or `COMPOSE_PROJECT_NAME`, would isolate them.
- **PDS-hosted audio is still scanned from a mutable source** ([#1778](https://github.com/zzstoatzz/plyr.fm/issues/1778), narrowed by #1790): the SSRF half is closed — `is_safe_url` now validates the endpoint where a miniDoc enters the system and at both `pds_blob_url` construction sites, and vendors are no longer pointed at the uploader-controlled URL. What remains is the scan-integrity half: a `did:web` track's bytes are served by the user's own host on every request, so a clean copyright scan does not pin what listeners later hear. Pinning the scan to `pds_blob_cid` means fetching and hashing blobs on the track-creation hook — the path #1519 deliberately made non-blocking — so it is a real change, not a validation tweak.
- **the transcoder's auth fails open** ([#1780](https://github.com/zzstoatzz/plyr.fm/issues/1780)): with `TRANSCODER_AUTH_TOKEN` unset it logs a warning and accepts every request, and the app has a public IP. Currently latent — the secret is set and the app is suspended — but `services/moderation/src/auth.rs` returns `SERVICE_UNAVAILABLE` in the same situation, so the transcoder is the outlier and this is a consistency fix.
- **CORS permits every HTTPS origin with credentials** (from #208, closed Feb 2026): `allow_origin_regex` resolves to `^(https://.+|http://localhost:\d+|null)$` with `allow_credentials=True`. Harmless today only because the session cookie is same-site and `SameSite=Lax` is carrying the entire defense — it would become a full CSRF-and-read hole the moment anyone sets `samesite="none"` for an embed, or moves the API off the `plyr.fm` registrable domain. #208's closing summary claimed "CORS validation" and its own item 1 (magic-byte MIME validation) never shipped; uploads still trust the client's `Content-Type`. Worth treating as a lesson about closing security issues against a summary rather than the running system.
- **staging's error-level `SELECT neondb` spans are a pool/suspend mismatch, now mitigated** (August 8): diagnosed and traced to `pool_recycle` (1800s, the default) being **6x longer than staging Neon's `suspend_timeout_seconds` of 300**. The compute scales to zero after 5 minutes idle and kills pooled connections; the next checkout gets a dead one, SQLAlchemy's `handle_error` fires and the OTel instrumentation stamps the span `ERROR` with `str(exc)` — which is empty for this exception class, hence an error with no message and no exception type. Production never sees it because its compute has `suspend_timeout_seconds: -1` (scale-to-zero disabled). **Functionally benign**: all 95 traces containing the error had a succeeding root span (`POST /tracks/` 200 x76, `optimize_track_audio` OK x11, `PUT /audio` 200 x8) — `pool_pre_ping` recovers transparently, so the cost was error-level noise rather than failed requests. `DATABASE_POOL_RECYCLE=240` was set on `relay-api-staging` and **has since been unset — the mitigation was worse than the problem**. Forcing a reconnect every 240s starved concurrent uploads behind the 3-per-artist gate: jobs stuck past ten minutes, the stuck-upload reaper firing repeatedly, and three album integration tests timing out at 300s. Unsetting it removed the timeouts in a single A/B (the failure signature changed from `Timeout (>300s)` to assertion errors, which is what identified it — not pass/fail). The residual assertion failures were debris: `_create_album` is idempotent on `(artist_did, slug)`, so a run killed by pytest-timeout before cleanup leaves its album behind and the next run reuses it and counts double. With the variable unset and the leftovers cleared, integration is green. The `SELECT neondb` noise is therefore back, and staying: it is benign, and the correct fix if it ever matters is disabling scale-to-zero on the staging compute, not shortening `pool_recycle`. The clusters were never "restart noise"; they track integration-test runs (03:25, 03:33, 05:10 on Aug 8; 04:36 on Aug 7), which is what a burst of uploads after an idle window looks like.
- **nothing records listening over time** (August 5 accounting; retention figure corrected August 9): `play_count` is a counter on the track row, so plays-per-day exists only inside Logfire's retention window — which is **far shorter than the 14 days assumed here**: on August 9 the earliest record in the project was the same day at 06:12 (see [#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)). The history before that is unrecoverable. Every day without an append-only play-events table (or a daily `/stats` snapshot) is another day of curve we cannot draw later. Deliberately not built yet — it is new surface, and the shape of it is undecided.
- ~~**the artwork accent wash is inert in production** (#1753)~~ — resolved
  August 10 by the media-bucket CORS policy (#1821). `images.plyr.fm` now sends
  `Access-Control-Allow-Origin: *` and canvas sampling no longer taints;
  verified via `getImageData` from a foreign origin. Wants a look at `/radio`
  to confirm the accent reads well now that it actually renders.
- **the `firehose` station has no recorded fallback** (#1741): waow.tech's sonification segments are `unlisted` and the radio corpus is public-only, so when the broadcast stops the station has nothing to play. It now says "off air" and keeps the tuner reachable (#1744) instead of stranding anyone, but publishing some segments publicly is the only thing that gives it real fallback material — a content decision, not a code one.
- **a failed radio play retries forever** (#1750): while the mobile tune-in was broken, the console logged `playback failed: AbortError` on a loop rather than once — something retries a failed radio `play()` indefinitely. Harmless now that playback works, which is exactly why it is worth writing down: it turned a single failure into continuous noise and would do so again for any future playback fault.
- **live radio is verified under WebKit emulation, not on a phone** (#1750): Playwright's WebKit with iPhone emulation reports `ManagedMediaSource`, so the iOS code path is genuine, but it is neither Mobile Safari nor Android Chrome. Playwright's bundled Chromium is worse for this — it decodes raw HLS natively, so it cannot reproduce the desktop failure at all. Live playback has no automated coverage on a real mobile browser.
- **the rev guard has a one-event window per track** (#1736): `atproto_record_rev` starts `NULL`, and ingest applies-and-learns rather than rejecting when it has no baseline — rejecting would silently drop legitimate edits from other clients. So each track's first update after the release is itself unordered. 6 of 1005 tracks have a rev as of August 9; the rest acquire one when they are next edited. Backfilling from each PDS record would close the window.
- **comment and list updates are still unordered** (#1736): the same last-writer-wins defect exists in `ingest_comment_update` and `ingest_list_update`. Only the track path was fixed, because that is the one that can strand audio bytes.
- **`_reference_count` cannot see `r2_url`** (#1735/#1736): the refcount that guards deletion matches `file_id`-shaped columns, so it cannot protect a row whose `r2_url` and `file_id` name different objects. `prune_revisions` now compensates locally; the general fix belongs in `_MEDIA_REFERENCES`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet.
- **the account-status reconciliation script has not been run against prod** (#1729): a dry run reports 5 artists whose `account_status` reason is `NULL` and would be filled in, with zero flags changed. Until it runs, those rows say an artist is hidden without saying why.
- **18 subjects await triage in the review queue** (recounted August 9; the copyright scanner keeps opening new fingerprint flags), still including track 64 (user report #5 from @vicwalker.dev.br). They are visible and playable in the dashboard; nobody has made a call on any of them. A fingerprint match is not a finding — several read as covers or remixes the uploader performed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (#958)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- social activity feed (#971)

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible, CDN via custom domains)
- background tasks: docket (Redis-backed)
- hosting: Fly.io (2x shared-cpu VMs)
- observability: Pydantic Logfire
- auth: ATProto OAuth 2.1

**frontend**
- framework: SvelteKit (v2.43.2)
- runtime: Bun
- hosting: Cloudflare Pages
- styling: vanilla CSS with lowercase aesthetic
- state management: Svelte 5 runes

**deployment**
- ci/cd: GitHub Actions
- backend: automatic on main branch merge (fly.io)
- frontend: automatic on every push to main (cloudflare pages)
- migrations: automated via fly.io release_command

**what's working**

**core functionality**
- ✅ ATProto OAuth 2.1 authentication
- ✅ multi-account support (link multiple ATProto identities)
- ✅ secure session management via HttpOnly cookies
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats and Media Session API
- ✅ timed comments with clickable timestamps
- ✅ artist profiles synced with Bluesky
- ✅ track upload with streaming
- ✅ audio streaming via 307 redirects to CDN (audio.plyr.fm, edge-cached)
- ✅ lossless audio (AIFF/FLAC) — AIFF uploads publish instantly as a 16-bit WAV compatibility rendition; the MP3 streaming rendition + PDS blob are produced by a deferred background task without blocking the upload
- ✅ PDS blob storage for audio (user data ownership)
- ✅ play count tracking, likes, queue management
- ✅ downloads — public ungated tracks (lossless originals preferred) and whole albums as cached zips, with a per-artist opt-out
- ✅ repeat-one on the player + queue sidebar toggle
- ✅ experimental subsonic-compatible surface at `/rest` (developer token as password)
- ✅ "keep playing" — opt-in continuous playback from the For You feed when the queue runs dry ("next from: for you")
- ✅ queue items with artwork thumbnails + right-side drag-to-reorder (desktop + touch)
- ✅ unified search with Cmd/Ctrl+K (keyword + mood search in parallel)
- ✅ mood search via CLAP embeddings + turbopuffer (feature-flagged)
- ✅ teal.fm scrobbling
- ✅ moderation on signed ATProto labels — copyright de-listing, adult-audio
  preferences, creator self-labels, an append-only `moderation_events` log
  behind the dashboard queue, and public decision posts from @moderation.plyr.fm
- ✅ display-sized artwork renditions from the Cloudflare edge
- ✅ ML genre classification with suggested tags in edit modal + auto-tag at upload (Replicate effnet-discogs)
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble, genre classification)
- ✅ media export with concurrent downloads
- ✅ supporter-gated content via atprotofans
- ✅ listen receipts (tracked share links with visitor/listener stats)
- ✅ jams — shared listening rooms with real-time sync via Redis Streams + WebSocket
- ✅ 96x96 WebP thumbnails for artwork (track, album, playlist)

**albums**
- ✅ album CRUD with cover art
- ✅ ATProto list records (auto-synced on login)

**playlists**
- ✅ full CRUD with drag-and-drop reordering
- ✅ ATProto list records (synced on create/modify)
- ✅ "add to playlist" menu, global search results
- ✅ composite covers from member-track artwork when no explicit cover is set
- ✅ inline track recommendations when editing (CLAP embeddings + adaptive RRF/k-means)

**deployment URLs**
- production frontend: https://plyr.fm
- production backend: https://api.plyr.fm
- staging: https://stg.plyr.fm / https://api-stg.plyr.fm

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- trade-off: accepting higher latency for faster development

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API, integrated CDN

**why async everywhere?**
- I/O-bound workload: most time spent waiting on network/disk
- PRs #149-151 eliminated all blocking operations

## cost structure

current monthly costs: ~$68/month (plyr.fm specific) — the live `/costs` feed is the source of truth (#1599); the breakdown below is indicative, not hardcoded. `COSTS.md` is the human-readable audit.

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (backend + redis ×2 + transcoder + moderation): the largest line; the prior ~$24 figure omitted both redis apps
- neon postgres: ~$5/month (moderation endpoint now autoscales 0.25–1 CU + scale-to-zero, was pinned always-on 1 CU)
- cloudflare (R2 + pages + domain): live feed reads $0 until CF is tagged `project=="plyr.fm"` upstream
- copyright scanning (AuDD): ~$5-10/month (computed from our own DB)
- replicate (genre classification): <$1/month (scales to zero, ~$0.00019/run)
- logfire: $0 (free tier)

## admin tooling

### content moderation
script: `scripts/delete_track.py`

usage:
```bash
uv run scripts/delete_track.py <track_id> --dry-run
uv run scripts/delete_track.py <track_id>
uv run scripts/delete_track.py --url https://plyr.fm/track/34
```

## for new contributors

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or install the [contribute skill](.claude/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-08-14 (**albums download as cached zips**. #1836 extends yesterday's download policy to albums — same shared `download_refusal`/`download_key`, zip built on the worker via the export machinery, cached in R2 under a digest of the ordered member keys so edits invalidate naturally, CDN-served by redirect; verified cold-build → SSE → zip → cache-hit on both staging and prod. #1834 brought the regrouped track page's mobile controls up to the 44px touch floor with press feedback on the play disc, punting the material treatment to #1835 rather than hardcoding a token-less one-off. #1837/#1838 fixed the brutal cold-download toast and captured the research as a `toast-copy` skill; #1839 caught the settings copy and docs.plyr.fm up to the feature. also: a 10-day orphaned vite on port 5199 had been silently absorbing every local dev-server start.) previously 2026-08-14 (**an album batch wedged the app VM**. the 02:02 UTC incident: aioboto3's upload reader eagerly queues 100 x 8MB parts per upload by default (~800MB), starving the 1GB app VM into page-cache thrash — process alive, logs/health/SSH all silent, zero 5xx in Logfire because failing requests never reached the app. #1831 capped uploader concurrency and was insufficient; re-review found the io_queue by reading the installed source, #1832 capped it to ~32MB per upload and moved the sync whole-file scans off the event loop. verified with the staging longform-WAV integration test, released clean. retro in docs/internal/runbooks/2026-08-14-upload-memory-wedge.md; open items: machine-level health alerting, app-VM sizing, /tmp exposure.) previously 2026-08-13 (**tracks are downloadable, and the detail page got its sketch**. #1824 adds `GET /audio/{file_id}/download` — presigned attachment named `artist - title.ext`, preferring the lossless original — for anything public, ungated, and un-copyright-labeled, with an `allow_downloads` artist opt-out defaulting on since the artist's PDS already serves the bytes to anyone. one policy module feeds both the endpoint and `TrackResponse.downloadable`, so the UI never offers what the endpoint refuses; adversarial review killed a dead-presigned-URL bug for PDS-only/ingested rows and an unordered scan-row read. #1825 fixed the circular import that crash-looped staging's app process — only uvicorn's import order hits it, so a regression test now imports backend.main in a fresh interpreter. #1826 rebuilt the track detail page to nate's notebook sketch: one controls line (like chip · circular play · bare queue icon), listens, unboxed share/download, `clamp()`ed gaps — the album-context/track-list half of the sketch deliberately punted. verified on prod end-to-end: downloaded the actual 16-bit WAV original with the right filename.) previously 2026-08-10 (**the media hosts never had a CORS policy at all**. An external developer asked for CORS headers to build a web DJ deck; the API has allowed any HTTPS origin since #1106, so the ask read as already-satisfied — but audio bytes come from R2 custom domains, where CORS is configured per-bucket, separately from the FastAPI middleware. All four public buckets returned "The CORS configuration does not exist" (code 10059): preflight 403, and a GET returning 206 with real bytes and no `Access-Control-Allow-Origin`. `<audio src>` playback worked throughout, which is why nothing surfaced it. Shipped `infrastructure/r2/cors.json` (#1821) to `audio-`/`images-{staging,prod}`, deliberately excluding the private buckets — those have no custom domain, `r2.dev` disabled, presigned-only, and `*` there *would* be an access-control change. On the public buckets it is not one: they are already reachable unauthenticated two ways, so `*` grants browsers a read any server-side script already had; no credential surface either, since R2 returns literal `*` and no `set_cookie` passes `domain=`. The bucket policy alone was insufficient — the 1yr edge TTL kept already-cached objects serving their header-less variant and `Vary: Origin` did not rescue them, so the two media hosts were purged by host rather than `purge_everything`. Verified as capability rather than headers: headless Chromium on a foreign origin read 24343244 bytes, decoded them (2ch 44100Hz 138.00s), and pulled 6085800 raw PCM samples. This also closes #1753 — the artwork accent wash was inert for exactly this missing header. Flagged but not addressed: `mirror_pds_blob` re-hosts firehose-ingested audio because a record was published, not because the artist asked — unchanged by CORS, but a real consent question. Also recorded #1818 (`just backend test` ran against **neon dev** rather than the compose postgres it started) and #1817 (plyr publishes a `community.lexicon.app.profile` record).) previously 2026-08-09 (**a track row's `file_id` is not a storage key**. Started from an artist asking why ten tracks weren't on their PDS — nine were the #1565 herd never repaired after June, the tenth failed on July 6 with the telemetry long since aged out. Repairing them surfaced three real defects: the image-origin allowlist was policing what plyr wrote to a creator's *own* repo and rejecting plyr's own pre-`images.plyr.fm` URLs (#1805, removed from the write path — ingest-side trust unchanged); PDS-save failures incremented a counter through four early returns with no log and no reason, so a batch reported "6 failed" with an empty error list and zero rows in Logfire (#1806/#1811); and underneath both, `Track.file_id` addresses storage only for uploads that came through us — on the ingest path it is the record's author-supplied `fileId`/rkey while the bytes live under the content hash in `r2_url`. Eight sites passed it straight into storage, including **track and account deletion, which silently orphaned the real object**, and media export, which silently omitted the track. Fixed via `AudioKey.for_track` and pinned by a source-scanning test that caught a ninth site mid-review. Verified on three production rows belonging to external users — 404 at the old key, 206 at the new one. Also: the portal states "all your audio is on your PDS" when there's nothing to do, a dismissible banner (per-account, not localStorage) surfaces the standing case, its CTA opens the picker directly, and the xdist test bootstrap no longer runs inside a per-test timeout (#1809 — the suite failed 5/5 when run CI's way). Four issues filed rather than carried quietly: #1812–#1815.) previously 2026-08-09 (**status maintenance for the August 5–9 window**. Archived the August 3–8 detail block to `.status_history/2026-08.md`, taking STATUS.md from 722 lines to ~460 — including the redis-password cutover and the write-echo alert's design write-up, both now history rather than current state. Backfilled the one thing this window shipped and never recorded here: **#1790**, which stopped handing AudD, Modal, and Replicate a `getBlob` URL built from an uploader-controlled `did:web` endpoint — a regression test on `main` produced the cloud metadata address from a stored `pds_url` — and replaced it with `mirror_pds_blob`, which fetches once through the hardened client, verifies the bytes hash to the `pds_blob_cid` the record commits to, and keys the copy by content hash rather than the record's attacker-supplied `fileId`. Also recorded the smaller August 8 changes that had no entry: environment-tagged operator alerts (#1793), the PDS-mirror backfill's docket client (#1791/#1792), and the `DATABASE_POOL_RECYCLE=240` staging mitigation being unset after it starved concurrent uploads (#1794). Rewrote current focus around the credential chain and folded the exclude-semantics work into the moderation arc. Recorded the podcast recap for August 5–9.) previously 2026-08-09 (**staleness sweep of known issues, verified against reality**. Retired the #1782 production-requirepass entry — the cutover ran August 8 (plyr-redis v2 + `REDIS_PASSWORD`) and an unauthenticated connection from inside the prod network now gets `AuthenticationError`; the issue is closed. Retired the "write-echo alert unexercised" entry — it fired for real on August 8 as a verified true positive (see the #1796 entry). Recounted the review queue: 18 subjects now await triage (was 13; the scanner keeps opening fingerprint flags), track 64 still among them. Updated the rev-guard coverage to 6 of 1005 tracks. Confirmed still true before keeping: the artwork accent wash stays inert (images hosts still send no `Access-Control-Allow-Origin`), and #1778/#1780 remain open.) previously 2026-08-09 (**search ranks lexical intent above trigram fuzz**. Closed #1523 via #1801, prod `2026.0809.034121`: one tiered relevance — exact > prefix > substring > fuzz — across all five search helpers, `word_similarity()` for intra-tier ties, quotes normalized on both sides; verified on prod that "you don't kn", "you don’t kn", and "you dont kn" all rank the reported title first. Also recorded the discovery that every checkout shares one compose project named `tests`, so concurrent agent sessions recreate each other's test databases — the source of the evening's "stale schema" ghosts, now a known issue.) previously 2026-08-09 (**exclude is curation, not removal, and the blackout alert's first firing**. Applied the override_exclude runbook to a user report of prayer recordings on radio, which surfaced two defects in the paradigm itself: radio never honored the projection (#1797), and exclude applied in every context, briefly blanking the artist's public profile before #1799 made it LIST-only — chosen surfaces exclude, destinations never do. Six events recorded with the transparency publisher paused so one curation call didn't become six posts; a batching implementation is parked on `feat/batched-transparency-posts`. Separately, the #1775 write-echo alert fired for real: jetstream2.us-east was externally verified blind to our collections while three sibling hosts served the same commit, and the 10s rotation rewind permanently skipped the event — #1796 filed for rewinding to the blind-window start. Also confirmed the #1523 search-ranking mechanism: bare trigram `similarity` structurally punishes long titles.) previously 2026-08-08 (**the staging db errors were a pool/suspend mismatch**. Diagnosed the error-level `SELECT neondb` spans that had been written off as restart noise: staging Neon suspends after 300s idle while `pool_recycle` defaults to 1800s, so pooled connections outlive the compute. SQLAlchemy recovers transparently via `pool_pre_ping` -- all 95 affected traces had succeeding root spans -- but the instrumentation stamps the failed attempt `ERROR` with an empty message, because the exception stringifies to "". Production is immune: scale-to-zero is disabled there (`suspend_timeout_seconds: -1`). Set `DATABASE_POOL_RECYCLE=240` on staging. The clusters track integration-test runs, not deploys.) previously 2026-08-08 (**redis had no password, and a redis blip took the whole API down**. Closed the remaining half of #1782: `plyr-redis` now requires a password (#1786), wrapped in `sh -c` because Fly exec's `[processes]` args rather than shelling them — unwrapped, `--requirepass $REDIS_PASSWORD` sets the password to that literal string and looks like it worked. Rehearsing the cutover on staging found a second, worse bug: `slowapi` hands storage exceptions to its rate-limit handler, which reads `exc.detail`, so an unreachable Redis returned `AttributeError` on every request including `/health` — a blip took the whole API down and failed the platform health check. Fixed in #1787 with an in-memory fallback that keeps limits enforced and probes for recovery. Verified by restarting staging redis under load: 150/150 requests returned 200, against the same scenario that produced blanket 500s an hour earlier. The production cutover is staged but not run — held for sign-off.) previously 2026-08-08 (**the session cache was handing out PDS credentials**. An external security assessment led with CSRF, which did not survive contact with the source — the API and frontend are same-site, so `SameSite=Lax` already withholds the cookie cross-site. Chasing "what do these compose into" instead of "is each one severe" found the real thing: `get_session()` decrypted the Fernet-encrypted OAuth blob and cached the plaintext in an unauthenticated Redis for 60s, keyed by the bearer token itself — and the payload included `dpop_private_key_pem`, which collapses DPoP's proof-of-possession back to bearer semantics. Fixed in #1783 (cache the ciphertext, key on sha256, drop the redundant id), #1784 (subsonic `/rest` had accepted any session id, not just developer tokens), #1781 (full session ids in debug logs). Verified by connecting to Redis in both environments and asserting on real entries: production failed every check before the release and passed all of them after. The regression test caught a bug in the fix — returning `None` on an undecryptable entry would have made an OAuth key rotation a mass logout. Transferable lessons in `docs/research/2026-08-08-credential-handling-in-atproto-appviews.md`. Four new known issues recorded rather than quietly carried: unauthenticated `plyr-redis` (#1782), the `did:web` SSRF-by-proxy and mutable-source scan (#1778), the transcoder's fail-open auth (#1780), and a CORS regex admitting every HTTPS origin that #208 closed as "CORS validation" in February.) earlier entries are preserved in `.status_history/2026-08.md`.
