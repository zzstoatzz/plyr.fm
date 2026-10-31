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

### October 2026

The day-by-day October entries are in `.status_history/2026-10.md`. The October
1–9 arcs (the copyright flag rework, the review queue's first decisions, private
media against current Spaces hosts, the embeds and the equalizer) were covered by
#2141 on October 11; what follows is October 11–31.

#### a third-party player, and the API changes it asked for (#2250–#2254, October 30–31 — prod `2026.1031.194332`)

renderg.host built **plylst**: a frontend-only site that gives every public
plyr.fm album a shareable page with a DJ-style waveform at the same path, links
back, credits plays after 30 s and honors `default_hidden_tags`. Their
[Tangled issue #6](https://tangled.org/zzstoatzz.io/plyr.fm/issues/6) (October 30)
asked for small API changes, all shipped October 31: the `?cors=1` audio proxy
exposes its range headers, signs HEAD requests to private R2 correctly (a
GET-signed URL used for HEAD got 403), and answers unsupported multi-range
requests with 416 instead of 502; track duration and album artwork, creation
time and play totals come straight from the API. Album owners can opt in to a
minimal plylst link (off by default, only for nonempty albums whose tracks allow
public listening), and album settings became compact disclosures with one
save/cancel footer. Plylst supports albums, not playlists, and reads production.
See [the integration](docs/internal/frontend/plylst.md). The same week, #2222
added the first public guide to playing plyr from a Subsonic app (docs only);
it lists six `/rest` defects noticed while writing it (known issues).

#### protected audio stays on the artist's PDS (#2233, #2237, #2238, #2244, #2246–#2249, October 28–29 — prod `2026.1029.040850` → `2026.1029.204905`)

A protected upload (signed-in-only, supporters, members) used to live only in
plyr's private R2. When the artist's PDS supports Spaces, the audio now stays
there: the artist owns a public-read, app-restricted **playback** Space that only
plyr's attested client can open, listeners stream through plyr and need neither a
Spaces PDS nor a credential, and the private R2 copy is a best-effort mirror
established after ownership. Uploaders on hosts without Spaces must explicitly
accept plyr-only storage. Existing catalogs are not migrated. Along the way: the
1.5 GiB case found a single-copy R2 promotion timeout, fixed with bounded
multipart copy (#2237); account deletion learned the protected source boundaries
(#2238, closing #2235); the October 29 spaces alpha removed
`com.atproto.simplespace.*`, so private spaces moved to `com.atproto.space.createSpace`
with a `memberspace` policy (#2248, prod `2026.1029.204905`); the client names
the authority as `#atproto_pds` and verifies commit MACs on `listRepoOps` (#2216,
#2226). Production browser smoke passed at desktop/light and mobile/dark, through
PDS ownership, anonymous playback, download denial and byte-exact owner recovery.
See [the contract and runbook](docs/internal/architecture/protected-pds-audio.md).

The same day, a real report (track 1656) showed that **owner-only listening
blocked audio but left title, policy and feed eligibility public** (#2244, prod
`2026.1029.063143`). Owner-only now restricts metadata to its owner across
listings, search, albums, interactions, Subsonic, activity, queue/jam hydration
and cached radio rotations; new owner-only uploads skip public post-create hooks.
Already-published public PDS records are not retracted (#2245, a separate
decision). Permission consent copy was rewritten and the deployed grants audited
(#2246); readiness now requires the complete owner-management grant per Space
(#2247). See the [permission audit](docs/internal/research/2026-10-29-permission-consent-audit.md)
and [owner-only visibility](docs/internal/backend/owner-only-visibility.md).

#### an AI agent's catalog, tags that travel, and a fairer latest feed (#2201, #2208, #2209, October 21–23 — prod `2026.1021.202702`, `2026.1023.055206`, `2026.1023.061530`)

penny.hailey.at, an AI agent, uploaded dozens of untagged tracks; 16 of the top 50
in latest were hers. plyr asked publicly on October 21 that they carry the `ai`
tag. Two changes made that possible without plyr writing on anyone's behalf:
**tags are now part of the track record** (#2201, prod October 21) — uploads and
edits write `tags` to the PDS, ingestion projects them, other clients' tags are
honored, and legacy DB-only tags migrate on an authorized login; Penny's 63
indexed tracks were refreshed and the three carrying `tags: ["ai"]` show it. And
**the labeler can label an account `ai`** (#2208, prod October 23): the label's
subject is the DID, it projects to `artists.operator_labels`, and the account's
tracks hide wherever the `ai` tag hides them (latest, for you, radio outside slop);
the artist page says so and still lists everything. Penny's own January essay had
proposed exactly an account-level label. Operators apply it with
`scripts/label_account.py`; see `docs/internal/moderation/label-policy.md`.
Separately, one artist uploading 4–11 mixes a day filled 41 of the top 50 latest
tracks; **latest now shows at most three tracks per artist per UTC week** (#2209,
prod October 23, announced October 27), computed after hidden-tag and label
filters so hidden tracks use no slot. Radio and for-you already diversified.

#### costs, and asking heavy uploaders for help (#2184, #2197, #2198, #2202, #2231, October 17–27)

The upload page offers GitHub sponsorship once an account's catalog passes
`UPLOAD_SPONSOR_THRESHOLD_HOURS` (default 24), showing uploaded hours and an
estimated copyright-scan cost (#2184, prod `2026.1018.011142`, announced October
18: moderation is plyr's largest operational cost). Uploads stay unrestricted.
Uploads and processing are paused for an explicit DID list in `upload_policy.py`
(#2197, prod `2026.1020.232806`); paused accounts see a notice and a private
feedback form that DMs the operator in full (#2198). Staging rests its worker and
Jetstream between tests and scales the app to zero (#2202), and the CLAP embedding
service scales to zero (#2231). `just staging-up` is now a step before verifying
anything that ingests.

#### listening history, and the chart to read it (#2191, #2212, #2218–#2220, October 19–23 — prod `2026.1019.172214` → `2026.1023.212809`)

The activity page has day/week/month/year/all-time ranges with hourly, daily and
monthly UTC buckets (#2191), a rolling-average line over faint raw bars, and
all-time starts at launch instead of six backdated 2021–2023 records (#2212). A
**plays** series reads the new `track_plays` table: one row per counted web or
Subsonic play, no listener identity. History before October 23 comes from
plyr-origin teal.fm scrobbles, backfilled as hourly docket tasks per account
(#2218–#2220; a refused collection is skipped, an unreachable host gives up after
a day), about a fifth of counted plays, drawn dashed and labeled "scrobbled plays
only". See `docs/internal/frontend/activity-chart.md`.

#### the sign-in page says where you're going (#2186, #2188, #2195, October 18–20 — prod `2026.1019.172214`, `2026.1020.202916`)

Once a handle resolves, the login page shows the account's avatar and name and the
button reads "continue at bsky.social ↗" (or the self-hosted host), with a line
that plyr.fm never sees your password. The host comes from the DID doc → PDS →
protected-resource metadata, never hardcoded. The lookup never blocks sign-in; a
cold resolution can take 3–10 s. The add-account menus still redirect immediately.

#### reliability, October 16–29

- **a Redis that accepts and never replies froze the API** (#2161, prod
  `2026.1016.204035`): py-spy caught SlowAPI's synchronous `evalsha` on the event
  loop. Reads bounded at 500 ms, limit checks in the thread pool.
- **uploads accepted 1.5 GiB, the transcoder rejected above 1 GiB; a Redis blip
  killed the Docket consumer while its heartbeat kept beating** (#2170, prod
  `2026.1017.062711`): one size contract, consumer failure exits the worker for
  Fly to restart, `/health/freshness` reports overdue queue work. The PDS alert
  retrospective and a CI audit from the same day were committed late (#2224).
- **expired PDS tokens were rejected mid-stream and never refreshed** (#2183);
  **a publishing token with a rejected refresh grant kept admitting uploads** —
  24 failed attempts for one account on October 28 — and is retired on confirmed
  `invalid_grant` (#2239; hotfixed from `production-fe` as #2240,
  `2026.1029.032248`, ahead of the protected-audio release). `just release` now
  refuses on diverged production history and offers a reconciliation (#2241).
- **deleting a track could deadlock with Jetstream's delete of the same record**
  and take an album cascade with it (#2228): the row is locked before the cascade.
- **moderation records private indexing decisions and ingest enforces them**
  (#2149–#2151, prod `2026.1016.192720`): an excluded URI can no longer trigger
  writes, mirroring or post-create work; the 42 operator exclusions were
  documented, not written.
- also: the new-track DM waits for the optimized rendition (#2221, closes
  #1932); ffmpeg from a digest-pinned image (#2200); certifi/webpki bumped for
  the eMudhra CA compromise (#2196); atlas and image moderation on Claude 5.5
  (#2225); staging integration suites run one at a time (#2227).

#### smaller, mostly frontend promotes

Drawers dismiss reliably by touch and don't flash back (#2148, #2167, #2179);
comments close button clears the composer (#2182); full-size covers before
thumbnails (#2159); queue artist links keep audio playing (#2160); radio skips a
station entry whose audio fails (#2187); catalog duration in weeks and days
(#2194); hide-tags is a ⌘K-style sheet above the iOS keyboard (#2211, #2215);
links menu fits phones (#2214); no touch focus or double-tap zoom (#2232); tag
suggestions survive focus moves and WebKit touch, caught only by real-browser
regressions (#2243); artist guide refreshed (#2223). Haptics on sheet settle
(#2169) merged with no promote behind it.

#### first anniversary (October 28)

The first commit was October 28, 2025; 400 production releases to date. The
whole-history episode, [plyr.fm update - year one](https://plyr.fm/track/1394),
was published October 11 (#2146). Three maintenance PRs (#2147, #2190, #2229)
remain unmerged, so this pass covers October 11–31 in one episode.

### September 2026

See `.status_history/2026-09.md` for detailed history. Headlines: the radio
page became the sister-radio fork and four catalog stations joined Ana's
sister network (#2097–#2107, September 28 — prod `2026.0928.035150`,
`2026.0928.140223`, `plyr-radio` Fly app; open: #2102, physical-iPhone
checks); Top Tracks opens on the past month (#2108, announced September 28);
the musician studio was paused, then removed (#2083, #2094); the upload
pipeline got `/health/freshness` and the reaper swept its null trap (#2084,
#2085, #2087); Blacksky's `repo:?` sign-in fix (#2089); the status podcast
moved to Gemini 3.8 in a step the writer cannot see (#2090, #2092); an upload
is two writes and one promise (#2075); the DPoP nonce was thrown away after
every request (#2072, #2073); publishing permissions are independent of
storage (#2047–#2058); the track-identity collision (#2026–#2028); the
spotify footer (#1987–#2004).

### August 2026

See `.status_history/2026-08.md` for detailed history. Headlines: client-side
writes phase 0 shipped August 31, reverted September 1 (#1948–#1952); resumable
uploads (#1947); attested.network supporter gating (#1936–#1939); access is the
space credential (#1930); the queue as a surface (#1907–#1924); editing a track
deleted its PDS audio (#1904).

### November 2025 – July 2026

See `.status_history/`, one file per month, `2025-11.md` through `2026-07.md`.
Arcs that used to sit under current focus are in `2026-09.md` with their open
threads; anything still live is in known issues.

## priorities

### current focus

**the radio page is the sister-radio fork, and the catalog is on the sister
network** (#2097–#2107, September 28 — prod `2026.0928.035150`,
`2026.0928.140223`; `plyr-radio` Fly app): the vendored SolidJS page from our
fork of Ana's sister-radio drives plyr's one audio element; presence is a
Redis lease per socket, identity from the session cookie only; four stations
are `did:web` identities with signed `pet.nkp.radio.station` records that
Ana's tuner discovers. Firehose is the single live HLS exception, and since
October 9 the radio embed airs it too (#2136). **next**:
#2102 moves the protocol surface into the backend and retires the one-machine
adapter (its signing key lives on a volume — losing it changes the station's
public key); verify mute, HLS and the reported track-boundary loop on a
physical iPhone; decide whether the compact embed gets a Media Session policy.

**an upload is two writes and one promise** (#2063, #2070, #2075, September
18–19 — prod `2026.0918.172630` → `2026.0919.214851`): the job row now decides
whether an upload is alive, hints precede bytes, and a failed job's media is
re-swept for seven days. The same window closed three races of one shape —
the Jetstream echo of plyr's own PDS write beating the task that made it
(#2066, #2069, #2070) — and the double-submitted form (#2063). Since
September 21 an external monitor can read the pipeline's pulse at
`/health/freshness`, and the reaper sweeps the pre-worker `pending` rows that
check measures (#2084, #2085, #2087). **next**, from garrison's essay: verify
the promoted object inside the publication step; a read-only inventory of
`audio/` against every media column; a sweep on `result.transfer`; a
compare-and-set finalize in `ingest_track_create` so the post-create hooks
cannot run twice (known issues); and, once a PDS nonce problem is not the
first suspect, a test account on blacksky.app.

**publishing permissions are independent of storage** (#2049, #2056, #2057):
Portal defaults, album application and per-track exceptions are in production.
Listening audience, downloads, discovery and rights metadata are separate choices.
Today “my Space members” also means private metadata; private R2 audio alone does
not hide a work, and since October 29 owner-only listening hides metadata too
(#2244). The playback Space (prod `2026.1029.040850`) preserves audience choices
without making a protected public work members-only. Moving existing works across
Space boundaries remains a separate migration decision.

**records are moving into the client's hands — parked until the sign-in design is redone** (plan `docs/plans/2026-08-31-client-side-writes.md`; #1948–#1950 shipped in prod `2026.0901.065150`, reverted September 1 in #1952): phase 0 made the frontend a second OAuth client and chained its consent after the cookie login, so every sign-in showed two authorization screens. the direction stands — the file an artist uploads goes in their PDS as-is, plyr indexes/mirrors/serves, and the backend stops authoring records on anyone's behalf — but the next attempt must fit inside the single existing login, with scope growing only when a feature that needs it is used. **next**: redesign how the browser gets a repo-write capability without a second flow, then phase 1 (likes).

**private media on permissioned spaces — in production since October 29, still
alpha-tracking** (#1557→#1574, #1684, #1876–#1905, #2233–#2249, epic #1384):
member-private metadata/audio lives in the artist-owned `self` Space, created
since #2248 with the October 29 `com.atproto.space` / `memberspace` methods; its
authority decides membership for each reader; supporter standing is independent.
Protected public audio lives in the separate public-read, app-restricted
`playback` Space (prod `2026.1029.040850`). Host support
(`describeServer.spacesAlpha`) and approved OAuth permissions are separate facts;
readiness requires the complete owner-management grant (#2247). Authority and
repo hosts resolve through `#atproto_pds`. Credential caches and issued mirror
URLs bound revocation without promising immediate recall. See [private media](docs/internal/architecture/permissioned-private-media.md)
and [protected public audio](docs/internal/architecture/protected-pds-audio.md).
Existing-catalog migration is a separate decision; the spec is still moving
(Bryan Newbold, October 11: network rollout expected by end of November).

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues

- **an owner-only work's public PDS record still names it** (#2245, October 29): #2244 hides title, policy and feed eligibility inside plyr, but the `fm.plyr.track` record for the reported track stays public on the PDS. Retracting or privately republishing it is an explicit decision, not made yet.
- **six `/rest` defects noticed while writing the Subsonic guide** (#2222, October 26, not fixed): `getArtist` loads the first 500 albums catalog-wide and then filters; `getOpenSubsonicExtensions` requires auth; `serverVersion` is `0.0.0`; album/playlist `duration` is 0; `scrobble` skips the adult/copyright filter; `getPlaylist` leaks raw exception text.
- **the moderation stream fixes are still open PRs** (#2152–#2155, October 16): replaying labels from ordered durable events, accepting standard CBOR label notifications, and keeping historical retractions from resolving current flags were prepared alongside #2149–#2151 and not merged. Also open: resuming stalled R2 reads (#2199) and signed-out hidden tags on latest (#2230).
- **optimizing a non-web-playable upload still takes ~5 minutes** (#1933): ~88 s of it is streaming the source out of R2 before ffmpeg starts. #2221 made the DM wait for it; the copy itself is unchanged.
- **uploads are paused for the accounts in `upload_policy.py`** (#2197, since October 20): the list is code, not configuration, and nothing in this window lifted it.
- **native radio has not been checked on a physical iPhone** (#2101, #2104, #2105, September 28): the mute fix targets a Safari behavior (`volume = 0` ignored) verified only with a stubbed element; a reported iPhone loop at a track boundary was not reproduced on desktop; HLS Firehose and the lock-screen presentation are unverified on a device. The same gap as the live-radio item below, now for the whole page. Station switching that "plays for a while and then dies" got a fix on October 8 (#2111) written as a hope; whether it held is unreported.
- **sister-radio syndication is one Fly machine with no redundancy** (#2103 → #2102): the `plyr-radio` adapter advertises four stations from a 512 MB machine in Chicago; if it is down, native `/radio` keeps playing but Ana's directory drops the stations after health checks. Consolidation into the backend is the fix.
- **post-create hooks may run twice when the Jetstream echo and the upload task both finalize a track** (staging track 9392, September 18, unreproduced): `ingest_track_create` finalizes a pending row with a plain ORM write, not a compare-and-set, and the upload task's own `post-create hooks completed` landed 14 s after `ingest: finalized pending track` for the same row. The hooks send the notification DM and start the copyright scan. Written up in #2070.
- **a track that publishes while its worker stalls keeps a `failed` job** (#2075, intentional for now): the user is told "timed out — please re-upload" and the re-upload is rejected as a duplicate. Teaching the reaper to recognize the committed track row and complete the job is deferred.
- **PDS blob upload to blacksky.app is unverified after the nonce fix** (#2072): the September 9 failure there had the same `ReadError('')` signature as selfhosted.social, which the fix cleared in prod, but there is no test account on blacksky. #2089 (September 22) fixed a separate Blacksky problem — sign-in dying on its `repo:?` scope serialization — and does not settle this one.
- **the Blacksky sign-in shim is still needed; nothing was filed upstream** (#2089, re-checked October 10): `oauth_compat.py` rewrites `repo:?collection=…` to `repo?collection=…` in the granted scope, for the exact issuer `https://blacksky.app` and nowhere else, before the normal scope check. Blacksky's PDS (rsky) still writes the stray colon at commit `7964ffa` (October 9): its repo prefix constant is `repo:`, `to_repo_scope` appends `?` to it, and its own test asserts the result starts with `repo:?`. Bluesky's reference parser (`@atproto/oauth-scopes`, October 9) rejects a positional part alongside a named `collection`, and the Python client follows it, so without the shim every Blacksky sign-in ends in `Scope mismatch`. It loosens no permission. Remove it when rsky emits `repo?`; the decision on October 10 was not to open an upstream issue.
- **the upload-stall alert shows three job IDs plus "(+N more)"** (#2087): the triage runbook's step 5 says to use the full IDs from the alert; the rest are in Logfire. The freshness monitor's wiring lives outside this repo.
- **nothing alerts when a workflow on main is red**: `e2e private media` failed on ten consecutive pushes (September 12–18) before anyone looked. `gh run list --workflow "e2e private media"` is the check until there is one.
- **the cross-account member leg of the private-media e2e still skips**: `ALPHA_TEST_HANDLE`/`ALPHA_TEST_PASSWORD` are not set, so the flow that adds a second account to a Space and plays the track never runs in CI.
- **light777.selfhosted.social's duplicate track (1323/1324) is theirs to remove**: same `file_id`, one R2 object; the refcount guard keeps the audio when either row is deleted. `test_refcount_prevents_r2_deletion` covers it.
- **staging has two artist rows for `nate.selfhosted.social`**: `GET /artists/by-handle/…` and `GET /albums/…` 500 with `MultipleResultsFound` on staging; prod has one row.
- **one artwork scan returned 400** (September 13, 18:33 UTC): track 1303's
  artwork saved and its CDN read returned 200, but the background request to
  the moderation service's `/scan-image` failed. The trace did not record the
  rejection reason. Neither successful artwork storage nor a completed task
  establishes that this image was scanned; diagnosis remains open.

- **Cloudflare's JAX colo serves 100% 5xx for the R2 media domains** (observed August 27, ~17:00Z onward): users routed to Jacksonville get 500/502 on `audio.plyr.fm`/`images.plyr.fm` while every other colo is healthy — player shows `NaN:NaN`, artwork missing, page otherwise fine. Nothing to fix on our side; unacknowledged on cloudflarestatus.com. If it persists, escalate to Cloudflare support with a ray ID from an affected user (`a31cbef0bed07221-JAX`), the zone, and the colo-scoped analytics. Remove this entry once the 5xx count at JAX drains.
- **a broker proof does not pin the payer record it signs** (#1939, observed August 26): across 7 sampled live attestations, the proof's inner `cid` matches no recomputable CID of the payer record's current content, with or without `signatures`. So verification pins the *proof* and trusts the broker's `verified` status, while mutable payer fields — including `subject`, the artist being supported — are taken on the payer's word. Forging supporter standing for an arbitrary artist still costs one real broker-verified payment to someone, which is why this shipped rather than blocked. Queued as a question for ATM; if the answer is "proofs aren't meant to pin content", the public `network.attested.payment.lookup` endpoint is the better branch anyway.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **a DM that fails for a transient reason is never retried** (September 1): `_send_track_notification` correctly leaves `notification_sent` false when the send fails, but the only caller that would retry it is the Jetstream identity-update hook, which does not fire for an ordinary upload. track 1264's chat timeout on September 1 is a permanent miss; #1953 fixed the revoked-session case only. a scheduled sweep of un-notified tracks older than a few minutes is the missing piece.
- **the revised private-media permission set is a re-consent event** (#1898): the `authority: "*"` reader permission only takes effect for sessions that consented after it was published, so a member added before their next sign-in cannot mint a credential yet. Credentials also live two hours by protocol with no revocation, so removal from a member list is eventual.
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **`just backend test` runs serially, CI runs `-n auto`** ([#1815](https://github.com/zzstoatzz/plyr.fm/issues/1815)): the two take different paths through `conftest.py` — serial uses `_setup_database_direct` with no template database, no advisory lock, and no per-worker redis db. The entire parallel bootstrap only ever executed in CI, which is why #1809's bugs were invisible locally despite failing 5/5 once run CI's way. Distinct from the shared-compose-project issue below, which is about *concurrent* sessions rather than parallel workers.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see. Narrowed by #2006 (September 3): a rotation triggered by plyr's own unechoed write rewinds the cursor to before that write, so plyr's own records are replayed; foreign-client writes have no stamp, so a blind host still loses them and nothing rotates for them.
- **parallel agent sessions share one test database** (found August 9): `backend/tests/docker-compose.yml` has no `name:` field, so compose derives the project name from the directory — every checkout/worktree of this repo maps to the same `tests-test-db-1`/`tests-test-redis-1` containers, and two sessions running tests concurrently silently recreate each other's schemas (see the #1801 technical notes for the evening this cost). A `name:` derived from the checkout path, or `COMPOSE_PROJECT_NAME`, would isolate them.
- **an unmirrored `did:web` track is still scanned from a mutable source** ([#1778](https://github.com/zzstoatzz/plyr.fm/issues/1778), narrowed by #1790): the SSRF half is closed — `is_safe_url` now validates the endpoint where a miniDoc enters the system and at both `pds_blob_url` construction sites, and vendors are no longer pointed at the uploader-controlled URL. What remains is the scan-integrity half: a `did:web` track's bytes are served by the user's own host on every request, so a clean copyright scan does not pin what listeners later hear. Pinning the scan to `pds_blob_cid` means fetching and hashing blobs on the track-creation hook — the path #1519 deliberately made non-blocking — so it is a real change, not a validation tweak.
- **the transcoder's auth fails open** ([#1780](https://github.com/zzstoatzz/plyr.fm/issues/1780)): with `TRANSCODER_AUTH_TOKEN` unset it logs a warning and accepts every request, and the app has a public IP. Currently latent — the secret is set and the app is suspended — but `services/moderation/src/auth.rs` returns `SERVICE_UNAVAILABLE` in the same situation, so the transcoder is the outlier and this is a consistency fix.
- **CORS permits every HTTPS origin with credentials** (from #208, closed Feb 2026): `allow_origin_regex` resolves to `^(https://.+|http://localhost:\d+|null)$` with `allow_credentials=True`. Harmless today only because the session cookie is same-site and `SameSite=Lax` is carrying the entire defense — it would become a full CSRF-and-read hole the moment anyone sets `samesite="none"` for an embed, or moves the API off the `plyr.fm` registrable domain. #208's closing summary claimed "CORS validation" and its own item 1 (magic-byte MIME validation) never shipped; uploads still trust the client's `Content-Type`. Worth treating as a lesson about closing security issues against a summary rather than the running system.
- **staging's error-level `SELECT neondb` spans are benign and staying** (August 8; full diagnosis in `.status_history/2026-08.md`): staging's Neon compute suspends after 5 minutes idle while `pool_recycle` is 1800s, so the next checkout gets a dead connection and the OTel instrumentation stamps an `ERROR` span with no message. `pool_pre_ping` recovers transparently — all 95 traces had a succeeding root span. `DATABASE_POOL_RECYCLE=240` was tried and unset again: forcing a reconnect every 240s starved concurrent uploads behind the 3-per-artist gate and timed out three album integration tests. The correct fix, if it ever matters, is disabling scale-to-zero on the staging compute.
- **the `firehose` station has no recorded fallback** (#1741): waow.tech's sonification segments are `unlisted` and the radio corpus is public-only, so when the broadcast stops the station has nothing to play. It now says "off air" and keeps the tuner reachable (#1744) instead of stranding anyone, but publishing some segments publicly is the only thing that gives it real fallback material — a content decision, not a code one.
- **a failed radio play retries forever** (#1750): while the mobile tune-in was broken, the console logged `playback failed: AbortError` on a loop rather than once — something retries a failed radio `play()` indefinitely. Harmless now that playback works, which is exactly why it is worth writing down: it turned a single failure into continuous noise and would do so again for any future playback fault.
- **live radio is verified under WebKit emulation, not on a phone** (#1750): Playwright's WebKit with iPhone emulation reports `ManagedMediaSource`, so the iOS code path is genuine, but it is neither Mobile Safari nor Android Chrome. Playwright's bundled Chromium is worse for this — it decodes raw HLS natively, so it cannot reproduce the desktop failure at all. Live playback has no automated coverage on a real mobile browser.
- **the rev guard has a one-event window per track** (#1736): `atproto_record_rev` starts `NULL`, and ingest applies-and-learns rather than rejecting when it has no baseline — rejecting would silently drop legitimate edits from other clients. So each track's first update after the release is itself unordered. 6 of 1005 tracks have a rev as of August 9; the rest acquire one when they are next edited. Backfilling from each PDS record would close the window.
- **comment and list updates are still unordered** (#1736): the same last-writer-wins defect exists in `ingest_comment_update` and `ingest_list_update`. Only the track path was fixed, because that is the one that can strand audio bytes.
- **`_reference_count` cannot see `r2_url`** (#1735/#1736): the refcount that guards deletion matches `file_id`-shaped columns, so it cannot protect a row whose `r2_url` and `file_id` name different objects. `prune_revisions` now compensates locally; the general fix belongs in `_MEDIA_REFERENCES`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet.
- **the account-status reconciliation script has not been run against prod** (#1729): a dry run reports 5 artists whose `account_status` reason is `NULL` and would be filled in, with zero flags changed. Until it runs, those rows say an artist is hidden without saying why.
- **33 subjects await a call in the review queue** (recounted October 2, after the first decisions): 11 leaked or unreleased recordings of another artist from one account, where de-listing is undecided; about 16 that need someone to listen, mostly claimed covers; 3 unofficial remixes, waiting on a policy; and track 64, which reads as a mix but carries user report #5 from @vicwalker.dev.br. Still unset: how unofficial remixes are treated, and whether a whole-track match from an unrelated account is enough to label without listening.
- **uploaders of 17 wrongly flagged tracks were never told** (October 1): the old rule showed them a copyright badge on their own track in the portal, some for two months. The flags are cleared; no notice was sent, by decision that day. One uploader replaced the audio four times while flagged.
- **two tracks cannot be scanned**: AuDD cannot extract audio from track 123's 19 KB file, and track 930 has sat in `pending` since April with an `r2_url` that returns 404. Three private tracks are unscanned by design.
- **the status podcast renders again, on a new Gemini key** ([#2123](https://github.com/zzstoatzz/plyr.fm/issues/2123), October 10): from about October 1 Google answered every generation call on the old key's project with `403 project has been denied access`, though the key still listed models; why that project was denied was never learned. A key on a different project was set as `GOOGLE_API_KEY` on October 10 and the September 23 → October 10 episode rendered with `gemini-3.8-flash-tts`. The episodes for September 23 → October 2 and October 2 → 5 were never made; this one covers both windows. **If Gemini refuses, the run fails and there is no episode**: a fallback voice (Kokoro on the runner) was built and rejected the same day as below the bar for something published under the project's name. `google-genai` is still unpinned in `scripts/generate_tts.py`.
- **a review item cannot be annotated without closing it**: an internal mark is an `acknowledged` event with a reason, so undecided items carry no note. A fan-taping mark published through the labeler has been raised as an idea and is not built.
- **copyright spend is not on the live cost feed**: AuDD is computed from hardcoded plan constants and Claude image moderation is tracked nowhere. The five-minute labeler poll (`sync_copyright_resolutions`) also likely keeps the moderation database from scaling to zero; the Neon side is unconfirmed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
- **skip handlers together with `seekto` have never been on a physical iPhone** (#1958, September 1; now true for everyone since the #2000 GA, prod `2026.0902.232901`): `seekbackward`/`seekforward` are registered next to the existing `seekto`, a combination none of the #1860–#1869 recipes tried, and iOS shows ±skip in place of ⏮/⏭ because of it. whether the lock-screen scrubber behaves differently with both is nate's phone to answer — and the flag that used to limit the blast radius is gone.
- **the iOS lock-screen scrubber cannot be dragged in the real app** ([#1870](https://github.com/zzstoatzz/plyr.fm/issues/1870)): metadata, times, and ⏮/⏭ all work; the scrubber never grabs on a physical iPhone under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. the deciding experiment — a minimal page on a physical phone, or Web Inspector attached to the device — has not run yet; the code is deliberately parked at the #1860 state.
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- drawn iconography: let people draw plyr's own icons doodl-style — slottable icon components, published icon collections, an explore page for them (nate, September 1: "soon, not exactly now"; the sibling repo `doodl` is the reference: `tech.waow.doodl.iconset` maps UI slots to drawing strongRefs)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- radio: a listener-side skip, and stations composed on the fly instead of prebaked lineups (#2077, from a `!skip` in stream chat, September 19)
- landing: headline totals from `/stats` and a "playing right now" strip of covers with relative timestamps, bandcamp-style (#2078)
- share to bluesky (#334)
- lyrics and annotations (#373)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- UX for text-forward audio — declare a track as a reading/audiobook/podcast, link the source text, transcript as accessibility (user request, August 27; tags + description cover it functionally today)
- community-contributed audio for text posts — writer opts in, a reader records, writer approves; plyr's part is only a track record referencing an external text record, the approval/surfacing UX belongs to text-side clients (August 27)
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
- framework: SvelteKit with Svelte 5 runes
- runtime: Bun
- hosting: Cloudflare Pages
- interface: persistent player and queue, search and discovery, publishing tools, shared listening, and embeds
- styling: vanilla CSS with shared design tokens
- state management: Svelte 5 runes

**deployment**
- ci/cd: GitHub Actions
- staging: backend (Fly.io) and frontend (Cloudflare Pages) deploy from `main`
- production: separate promote via `just release` (backend/mixed) or `just release-frontend-only` (frontend only); see `docs/internal/deployment/environments.md`
- migrations: automated via fly.io release_command

**what's working** (the full checklist as of October 31 is in
`.status_history/2026-10.md`; the public feature docs are at docs.plyr.fm)
- ATProto OAuth 2.1 sign-in, multi-account, HttpOnly sessions, developer tokens
- upload (streaming, resumable, lossless AIFF/FLAC with deferred MP3 rendition), PDS blob storage, protected audio on the artist's PDS through Spaces
- player, queue, repeat-one, "keep playing", jams, radio (sister-radio fork), embeds, Subsonic `/rest`, timed comments, likes, play counts and `track_plays` history
- albums and playlists as ATProto list records, composite covers, edge artwork renditions, cached album zips, download policies, supporter gating
- search (keyword + CLAP mood), genre auto-tags, portable track tags, teal.fm scrobbling
- moderation on signed labels: copyright de-listing, adult audio, account-level `ai`, indexing decisions, event log and public decision posts

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

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or use the shared [contribute skill](.agents/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-10-31 by the status-maintenance
pass covering October 11–31 (window opened by #2141): October's day-by-day
entries moved to `.status_history/2026-10.md`, resolved known issues archived.
