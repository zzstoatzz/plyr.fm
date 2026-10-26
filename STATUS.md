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

#### the latest feed stopped being one account's feed: portable tags, account `ai` labels, and a per-artist cap (#2201, #2206–#2209, October 21–23 — prod `2026.1021.202702`, `2026.1023.055206`, `2026.1023.061530`)

On October 21 the latest feed's top 50 was 41 tracks from addline.selfhosted.social
(4–11 mixes a day) and 16 untagged generated tracks from penny.hailey.at, an AI
agent. Three changes, in order:

- **tags live in the track record** (#2201, prod October 21): `fm.plyr.track`
  gains an optional `tags` array (20 max; the editor still allows ten). Uploads
  and tag edits write the PDS first; a failed PDS write cannot become a DB-only
  edit. Ingestion projects tags from any client. Edits patch only the requested
  fields with a CID `swapRecord`, and every rebuild keeps unknown fields and
  `createdAt`. Legacy DB-only tags migrate on an authorized login and never
  overwrite a tag field already in the record, even an empty one. Staging ran
  the smoke against API uploads and direct PDS writes; the full integration
  suite was 22/23, the 1.5 GB FLAC boundary failing on an R2 read timeout that
  predates the change (#2199). After release, all 63 of Penny's indexed tracks
  were refreshed from her PDS: three carried `tags: ["ai"]`. nate had asked
  her on October 21 to tag her uploads `ai`; she agreed, and her next tracks
  arrived without the field. The docs now say what the `ai` tag does (#2206).
- **the labeler can label an account `ai`** (#2207 plan, #2208, prod October
  23): the label's subject is the DID. It projects onto
  `artists.operator_labels` (migration `4b8b60103ed2`) and hides the account's
  tracks exactly where the `ai` tag does — latest, for you, every station but
  slop — through one `hidden_by_tags_clause`. A listener who unhides `ai`
  sees both. Artist pages note "ai-generated audio · labeled by plyr.fm" and
  still list every track; transparency posts say "labeled an account" without
  naming it. Operators apply it with `scripts/label_account.py`. Whether
  penny.hailey.at has been labeled in production is not recorded here. The
  shape — an account-level, `inform`, no-blur label — is what Penny herself
  proposed for LLM accounts in a January WhiteWind post.
- **three tracks per artist per UTC week on latest** (#2209, prod October 23):
  a `row_number()` over the already-filtered set, before the cursor, so hidden
  tracks use no slot and paging never admits a dropped track. On prod's latest
  200 the first page goes from 6 artists to 22. Artist pages, radio (already
  spaced) and for you (already diversified) are unchanged. 2.7 ms on prod.

#### listening history: the activity chart, `track_plays`, and the teal backfill (#2191, #2192, #2210, #2212, #2218–#2220, October 19–26 — prod `2026.1019.172214`, `2026.1023.081940`, `2026.1023.212809`, `2026.1026.042015`)

The activity page's seven-point sparkline became a chart with day / week /
month / year / all-time ranges, hourly-to-monthly UTC buckets, zero fill, and a
fixed readout for hover, touch and keyboard (#2191, prod October 19; light-mode
contrast #2192). #2212 (prod October 23) draws a rolling mean over faint raw
bars (3h / 12h / 3d / 7d by range; the partial bucket feeds no average), starts
all-time at `PLYR_LAUNCH` instead of six 2021–2023 record dates, and adds a
**plays** series from a new `track_plays` table: one row per counted web or
Subsonic play, no listener DID, unique on `(track_id, played_at, source)`. The
"nothing records listening over time" known issue is closed by it. History
before `tracked_since` comes from plyr-origin teal.fm scrobbles read from each
account's own PDS — about 4,000 plays from 39 listeners, roughly a fifth of
counted plays, drawn dashed as "scrobbled plays only" and never scaled up.
The backfill moved from a heavypad script to hourly docket tasks on the worker
(#2218), then learned to resolve the PDS from the DID document instead of the
cached `pds_url` and to skip only a refused collection (#2219, after one
account's `alpha.feed.play` 400 hid its `feed.play`), then to give up on an
unreachable host after 24 attempts (#2220: two `did:web` documents that don't
resolve, a dead hostname, two TLS failures, a 503 from arcnode.xyz). Durations
read in weeks and days past 24 hours (#2194, promote October 19). See
`docs/internal/frontend/activity-chart.md`.

#### moderation is the largest cost, so the upload page says so (#2184, #2197, #2198, #2202, #2203, October 17–22 — prod `2026.1018.011142`, `2026.1020.232806`, `2026.1020.235959`, `2026.1023.055206`)

- **upload sponsorship** (#2184, prod October 18, announced the same day):
  above `UPLOAD_SPONSOR_THRESHOLD_HOURS` (default 24) of catalog audio the
  upload page shows a dismissible GitHub-sponsor card with the account's hours
  and an explicitly estimated copyright-scan value ($1.50/hour, from retained
  successful scans). Dismissal follows the account for 30 days. Uploading is
  unrestricted. The provider-attempt ledger is still #2163.
- **an upload pause for listed accounts** (#2197, #2198, prod October 20–21):
  a DID list in `upload_policy.py` (initially AddLine) refuses new uploads,
  replacements and queued processing, and ignores external creates and audio
  changes through ingestion; metadata edits, deletes and already-published
  conversions still run. The notice carries a private feedback form (1–2000
  chars, three/hour, persisted to `upload_feedback`) and an optional Bluesky
  link. Encounters, refusals and full feedback reach the operator DM bot via
  Docket with a bounded direct fallback; a partial multi-DM delivery can repeat
  on retry. The paused user is not messaged.
- **staging rests at near zero** (#2202, #2203, October 22): `app` scales to
  zero; `worker` and `jetstream` stay stopped until a test or `just staging-up`
  wakes them, and an hourly workflow rests them when no deploy, integration or
  e2e run is active. A rested jetstream ingests nothing, so "verify on staging"
  now starts with the wake. `plyr-radio-preview` scaled to zero the same day.

#### the private-media client caught up with the October 22 spaces alpha (#2213, #2216, #2226, October 23–26 — prod `2026.1023.081940`, `2026.1023.084007`, `2026.1026.042015`)

Upstream's `release-10-22` changed the credential exchange: `getSpaceCredential`
takes an unsigned body with `credentialKid` (the P-256 `did:key` the credential
binds to), and reads sign as `Atproto-Space-Credential` with the tag in the
signature. zds already refused the old request (`400 Missing credentialKid`),
which is how the live private-media test caught it (#2213). #2216 ports the
shared-secret commit MAC — DHKEM(P-256) against the author's `#atproto_kem` key,
HMAC over `(space, repo, rev, data)` — requested and verified on `listRepoOps`
when the author publishes a KEM key; zds publishes none and still returns the
old signed commit, so a live MAC round trip is unverified. #2213 left the client
attestation's audience as `#atproto_space_host`, which the alpha dropped;
`e2e private media` failed on every push for three days until #2226 named the
authority `<did>#atproto_pds`. Production carried the same bug from October 23
to 26. poe's October 19 dispatch and Bryan Newbold's October 11 note both place
the spaces beta on real PDSes by late November.

#### uploads: capacity, stalls, and the morning the worker was alive but idle (#2161, #2170, #2171, #2183, #2200, #2221, #2224, #2227, #2228, October 16–26)

- **the API accepted 1.5 GiB and the transcoder 1 GiB** (#2170, prod
  `2026.1017.062711`): seven attempts on one 1,080 MiB FLAC died as an empty
  `ReadError`. One size contract drives both and the transcoder deploys first.
  The same PR makes a Docket consumer failure exit the worker — on October 16 a
  Redis restart killed the consumer while its heartbeat kept beating, and 400
  tasks waited six hours for a human (#2168 open for the recovery loop;
  retrospective `docs/internal/retrospectives/2026-10-17-upload-failures.md`).
- **a silent Redis froze the whole API** (#2161, prod `2026.1016.204035`):
  SlowAPI's synchronous `evalsha` ran on the event loop. Reads are bounded at
  500 ms and limit checks run in the thread pool.
- **expired PDS tokens are refreshed before the audio stream opens** (#2183,
  prod `2026.1018.002803`); the alert that repeated each event four times was
  retuned (`2026-10-17-pds-alert-noise.md`, committed with #2224).
- **ffmpeg comes from a digest-pinned image** (#2200, prod `2026.1021.051710`):
  johnvansickle.com stopped answering on October 21 and every deploy failed
  with it. Same 7.0.2 release.
- **the new-track DM waits for the mp3** (#2221, prod October 26, closes #1932):
  sent after the swap commits, or anyway if optimize cannot finish. The 88 s
  R2→disk copy is still #1933.
- **a track delete deadlocked with Jetstream's delete of the same record**
  (#2228, prod `2026.1026.052602`): the API locks the `tracks` row before the
  ORM cascade; an album cascade rolls back a failed track. Two staging
  integration runs at once restart the API under each other; #2227 serializes.
- **private indexing decisions** (#2149–#2151, #2156, prod `2026.1016.192720`):
  exact-URI exclusions that assert no abuse and publish no label; ingest
  consults them before creating, finalizing or updating a track and fails
  closed without credentials. 42 were written (events 218–259).

#### smaller, October 16–26

- **the sign-in page says who you are and where you're going** (#2186, #2188,
  #2195, prod `2026.1019.172214`, `2026.1020.202916`): once a handle resolves,
  an avatar row and "continue at bsky.social ↗" (or the account's own host,
  from its DID doc). The lookup never blocks sign-in; a cold resolve took up
  to 10 s. After 4 s of redirecting: "some servers take a few seconds".
- **the equalizer's backend half reached prod** in `2026.1016.192720`; #2157
  adds a production smoke through the CORS proxy and records the Cloudflare
  header rule that gives cached public audio its missing ACAO.
- **hide-tag is a ⌘K-style sheet** (#2211, #2215, promote October 23), pinned
  above the iOS keyboard; **the image-flag DM names and links the owners**
  (#2189); **atlas and image moderation moved to Claude 5.5** (#2225).
- **drawers and trays** dismiss reliably and stay offscreen through teardown
  (#2148, #2167, #2179, promotes October 17); full-size album cover first
  (#2159); audio keeps playing across queue artist links (#2160); radio skips a
  dead station entry (#2187); comments close button (#2182); links menu on
  phones (#2214).
- **docs**: a Subsonic-client guide (#2222, noting six `/rest` defects), the
  artist guide refreshed (#2223), local setup aligned (#2175, #2178); staging
  replacement scans no longer call AuDD (#2166).
- **the status podcast was rewritten for listeners** (#2146, October 11): rules
  in `.github/prompts/status-podcast.md`, two podcast-host voices, and merging
  the PR published a year-one episode.

#### October 1–9

See `.status_history/2026-10.md` for the full entries. Headlines: the embeds,
the radio page's loose ends and an in-browser equalizer (#2111, #2129–#2138,
frontend promotes October 8–9); the review queue's first decisions, 76 → 33
open (October 2, no code); private media ported to the permissioned-data
branch and unmirrored tracks from other clients mirrored and scanned (#2121,
#2122, #2124, prod `2026.1002.021006`, `.054138`); a copyright flag now means a
recording plays through the upload (#2112–#2117, moderation service v77).

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

**the latest feed is shared again, and tags are the record's** (#2201, #2208,
#2209, October 21–23): the PDS is the authority for a track's tags, an account
can carry an `ai` label from plyr's labeler, and latest caps each artist at
three a week. **next**: confirm and record whether penny.hailey.at is labeled
in production and what the latest feed looks like after; a per-artist cap is
not a volume policy for radio or for you (both already space artists); search
still has no hidden-tag filter, by decision; self-labels and third-party
labelers are not read.

**listening history has a table** (#2212, #2218–#2220, October 23): every
counted play writes `track_plays`; scrobbled history is backfilled from each
listener's own PDS and marked as such. **next**, from the plan: the stream
archive (~35 GB for this slice) as a source, live teal ingestion, and whether
listener identity ever belongs in the table (today it does not, by design).

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
18–19; #2170, #2183, #2221, #2228, October 17–26): the job row decides whether
an upload is alive, hints precede bytes, and a failed job's media is re-swept
for seven days. October added one size contract across API and transcoder, a
worker that dies when its consumer does, token refresh before the audio stream
opens, a DM that waits for the mp3, and a delete that cannot deadlock with
Jetstream's. **next**: the approval-gated stall recovery in #2168; the R2 read
stall behind the 1.5 GB FLAC failures (#2199); a compare-and-set finalize in
`ingest_track_create` so the post-create hooks cannot run twice (known issues);
a read-only inventory of `audio/` against every media column; and, once a PDS
nonce problem is not the first suspect, a test account on blacksky.app.

**publishing permissions are independent of storage** (#2049, #2056, #2057):
Portal defaults, album application and per-track exceptions are in production.
Listening audience, downloads, discovery and rights metadata are separate choices.
Today "my Space members" also means private metadata; private R2 audio alone does
not hide a work. Future Space-backed storage must preserve those audience choices,
rather than turn every protected work into members-only content. Moving existing
works across Space boundaries remains a separate migration decision.

**records are moving into the client's hands — parked until the sign-in design is redone** (plan `docs/plans/2026-08-31-client-side-writes.md`; #1948–#1950 shipped in prod `2026.0901.065150`, reverted September 1 in #1952): phase 0 made the frontend a second OAuth client and chained its consent after the cookie login, so every sign-in showed two authorization screens. the direction stands — the file an artist uploads goes in their PDS as-is, plyr indexes/mirrors/serves, and the backend stops authoring records on anyone's behalf — but the next attempt must fit inside the single existing login, with scope growing only when a feature that needs it is used. **next**: redesign how the browser gets a repo-write capability without a second flow, then phase 1 (likes). The sign-in page's new preview row (#2186) is the first piece of that redesign that shipped.

the August arcs that sat here until September 20 — the spotify footer, supporter standing via attested.network, the iOS lock-screen scrubber, the credential chain — are in `.status_history/2026-09.md` under "priorities archived 2026-09-20"; their open threads are in known issues.

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876–#1905, #2121, #2213, #2216, #2226, epic #1384): private audio in an artist-owned permissioned space (never R2), credential-gated playback, and since August 22 an artist-named member list rather than owner-only — the `simplespace` member list on the artist's PDS decides, and plyr never stores membership: it asks the space host for a credential with the reader's session and holds that answer for the credential's lifetime (a refusal for five minutes), so a change the artist makes from any client is honored without plyr in the loop. Every sign-in requests the private-media permission set and a spaces PDS expands it into `space:` grants at consent, so the *grant* is the capability signal. The wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; since October 23 that is the `release-10-22` shape — unsigned credential requests carrying `credentialKid`, `Atproto-Space-Credential` reads, a client attestation naming `<did>#atproto_pds`, and an optional commit MAC that plyr verifies on `listRepoOps` when the author publishes `#atproto_kem`. zds tracks that branch and has rejected stale bodies three times (#1656, #1876, #2213), so drift there shows up as a failed live private-media test; zds is itself behind on commit MACs. Upstream expects the beta on real PDSes by late November. **open**: the cross-account e2e leg needs its `ALPHA_TEST_*` secrets; a live MAC round trip is unverified; downloads of private tracks are still refused for everyone, owner included, until a private download byte path exists; space-host resolution still tries `#atproto_space_host` before `#atproto_pds`. Design: `docs/internal/architecture/private-media-access-list.md`, `permissioned-private-media.md`.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues

- **long-standing issues parked on October 26** (still open, unchanged since August or earlier): CORS with credentials for every HTTPS origin (#208), the PDS picker (#1814), serial vs `-n auto` tests (#1815), orphaned R2 objects (#1367), the blind jetstream host (#1796), the shared test database across checkouts, `did:web` scan integrity (#1778), the transcoder's fail-open auth (#1780), staging's benign `SELECT neondb` error spans, the firehose station's missing fallback (#1741), the radio retry loop and WebKit-only live-radio coverage (#1750), the rev guard's one-event window and unordered comment/list updates (#1736), `_reference_count` and the seven dead tracks (#1735/#1737), the unrun account-status script (#1729), the broker proof that pins nothing (#1939), re-consent for the reader permission (#1898), Logfire retention (#1813), review items that cannot be annotated, and the iOS lock-screen, PWA and in-app-browser audio items (#1870, #1958, #779); also the upload-stall alert's truncated IDs (#2087), light777's duplicate track, staging's duplicate `nate.selfhosted.social` row, the browser e2e's CSP stop at PDS sign-in, track 1303's 400 artwork scan, the 17 untold uploaders, tracks 123 and 930 unscannable, Cloudflare at $0 on `/costs` (#1599), and the DMCA surface (#1715). Full text in `.status_history/2026-10.md` under "known issues parked".
- **the moderation labeler's `queryLabels` answered `DatabaseError: pool timed out`** on October 26 about 15:12Z for a single-DID query. Unexplained; the five-minute `sync_copyright_resolutions` poll and the label stream both depend on it, and #2149 means a failed read aborts the pass rather than erasing labels. Check the moderation Neon endpoint (`rough-hall-37695610`) and the service's pool size.
- **the 1.5 GB FLAC integration test fails on an R2 read stall** ([#2199](https://github.com/zzstoatzz/plyr.fm/issues/2199), since October 18): the read of the staged object times out before the record is published. It failed the same way before #2201 and after; #2227 stops a second run from restarting the API under it, which was a separate cause on October 26.
- **the worker can be alive and idle** ([#2168](https://github.com/zzstoatzz/plyr.fm/issues/2168), October 16): a Redis restart killed the Docket consumer while its heartbeat continued; 400 tasks waited six hours for an operator restart. #2170 makes consumer failure exit the worker so Fly restarts it, and the freshness probe reports overdue scheduled work; the approval-gated recovery loop the issue asks for is not built. The consumer failure mechanism itself is not established.
- **private media reads were broken in production October 23–26** (#2213 → #2226): the attestation audience was stale for three days and nobody reading private audio would have gotten a credential. Logfire showed no `getSpaceCredential` failures before #2213 either; whether anyone read private media in that window is unknown.
- **native radio has not been checked on a physical iPhone** (#2101, #2104, #2105, September 28): the mute fix targets a Safari behavior (`volume = 0` ignored) verified only with a stubbed element; a reported iPhone loop at a track boundary was not reproduced on desktop; HLS Firehose and the lock-screen presentation are unverified on a device. Station switching that "plays for a while and then dies" got a fix on October 8 (#2111) written as a hope; whether it held is unreported.
- **sister-radio syndication is one Fly machine with no redundancy** (#2103 → #2102): the `plyr-radio` adapter advertises four stations from a 512 MB machine in Chicago; if it is down, native `/radio` keeps playing but Ana's directory drops the stations after health checks. Consolidation into the backend is the fix.
- **post-create hooks may run twice when the Jetstream echo and the upload task both finalize a track** (staging track 9392, September 18, unreproduced): `ingest_track_create` finalizes a pending row with a plain ORM write, not a compare-and-set, and the upload task's own `post-create hooks completed` landed 14 s after `ingest: finalized pending track` for the same row. The hooks send the notification DM and start the copyright scan. Written up in #2070.
- **a track that publishes while its worker stalls keeps a `failed` job** (#2075, intentional for now): the user is told "timed out — please re-upload" and the re-upload is rejected as a duplicate. Teaching the reaper to recognize the committed track row and complete the job is deferred.
- **PDS blob upload to blacksky.app is unverified after the nonce fix** (#2072): the September 9 failure there had the same `ReadError('')` signature as selfhosted.social, which the fix cleared in prod, but there is no test account on blacksky. #2089 (September 22) fixed a separate Blacksky problem — sign-in dying on its `repo:?` scope serialization — and does not settle this one.
- **the Blacksky sign-in shim is still needed; nothing was filed upstream** (#2089, re-checked October 10): `oauth_compat.py` rewrites `repo:?collection=…` to `repo?collection=…` in the granted scope, for the exact issuer `https://blacksky.app` and nowhere else, before the normal scope check. Blacksky's PDS (rsky) still writes the stray colon at commit `7964ffa` (October 9); Bluesky's reference parser rejects it, so without the shim every Blacksky sign-in ends in `Scope mismatch`. It loosens no permission. Remove it when rsky emits `repo?`; the decision on October 10 was not to open an upstream issue.
- **nothing alerts when a workflow on main is red**: `e2e private media` failed on ten consecutive pushes (September 12–18), and again on every push from October 23 to 26 (#2213 → #2226), before anyone looked. `gh run list --workflow "e2e private media"` is the check until there is one.
- **the cross-account member leg of the private-media e2e still skips**: `ALPHA_TEST_HANDLE`/`ALPHA_TEST_PASSWORD` are not set, so the flow that adds a second account to a Space and plays the track never runs in CI.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **a DM that fails for a transient reason is never retried** (September 1): `notify_new_track` correctly leaves `notification_sent` false when the send fails, but nothing sweeps un-notified tracks; #2221 added a second caller (the optimize task) without changing that. a scheduled sweep of un-notified tracks older than a few minutes is the missing piece.
- **33 subjects await a call in the review queue** (recounted October 2): 11 leaked or unreleased recordings of another artist from one account, where de-listing is undecided; about 16 that need someone to listen, mostly claimed covers; 3 unofficial remixes, waiting on a policy; and track 64, which reads as a mix but carries user report #5 from @vicwalker.dev.br. Still unset: how unofficial remixes are treated, and whether a whole-track match from an unrelated account is enough to label without listening. Private indexing exclusions (#2150) are a separate ledger from this queue.
- **the status podcast depends on one Gemini key** ([#2123](https://github.com/zzstoatzz/plyr.fm/issues/2123)): if Gemini refuses, the run fails and there is no episode; the Kokoro fallback was rejected on October 10 as below the bar. `google-genai` is still unpinned in `scripts/generate_tts.py`. Since #2146 the script and voices are tuned for a listener, not a reviewer.
- **copyright spend is not on the live cost feed**: AuDD is computed from hardcoded plan constants and Claude image moderation is tracked nowhere; the upload-sponsor card's $1.50/hour estimate is the only user-facing number and is labeled an estimate. The five-minute labeler poll likely keeps the moderation database from scaling to zero; the Neon side is unconfirmed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **six `/rest` defects found while writing the Subsonic guide** (#2222, October 26, unfixed): `getArtist` loads the first 500 albums catalog-wide before filtering; `getOpenSubsonicExtensions` requires auth; `serverVersion` is `0.0.0`; album and playlist `duration` is always 0; `scrobble` skips the adult/copyright filter that `getSong` and `stream` apply; `getPlaylist` leaks raw exception text.

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
- ✅ independent listening and download permissions, inherited as snapshots from Portal/album defaults with per-track overrides; downloads prefer lossless originals, and whole albums use cached zips
- ✅ repeat-one on the desktop player
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

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or use the shared [contribute skill](.agents/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-10-26 (status maintenance): the
October 11–26 window written up (#2146–#2228: portable tags, account `ai`
labels and the per-artist cap; `track_plays` and the teal backfill; the
sponsorship card and the upload pause; the October 22 spaces-alpha port; the
upload capacity and worker-stall fixes); the track-tags entry corrected from
"staging verification pending" to prod `2026.1021.202702`; the October 1–9
entries and six closed known issues moved to `.status_history/2026-10.md`.
before that, 2026-10-10: the October 3–9 window (#2111, #2129–#2138) and the
equalizer's prod split.
