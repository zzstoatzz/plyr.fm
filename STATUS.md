# plyr.fm - status

Start here for the next agent: the [Next handoff](docs/research/2026-11-12-next-handoff.md)
and the Svelte web port in #2650; production (plyr.fm) is unchanged by Next.

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

### November 2026

455 commits merged between November 1 and 16, nearly all under `next/`, the
rewrite that runs beside production at next.plyr.fm. Next deploys through its own
workflows to its own Fly apps, Neon branch, Redis, R2 and Pages project, so none of
that work is in a production release; "live on Next" below never means plyr.fm.
Production shipped in six backend releases (`2026.1102.163235` → `2026.1115.064451`)
and five frontend promotes. The verbose checkpoint entries the Next sessions wrote
into this file as they landed are preserved in `.status_history/2026-11.md`.

#### the Next client went to Expo on November 3 and back to Svelte for the web on November 15 (#2280–#2331, #2650–#2687 — next.plyr.fm; production untouched)

Next's shape on November 2: the Zig backend, web client and audio worker moved
under `next/` (#2291); the appview became read-only with client-owned OAuth and
direct PDS writes (#2281–#2284); a blob mirror copies PDS audio into R2 verified
by CID (#2285–#2287); ingest reads jetstreams instead of the relay (#2292); the
real `fm.plyr.*` records are indexed and written (#2299), and cover art is an
`imageBlob` on `fm.plyr.track` and `fm.plyr.list` on the artist's PDS (#2306).
On November 3, #2331 replaced the SvelteKit client with one Expo / React Native
app for iOS, Android and web, and the Expo web export took over next.plyr.fm.
The next ten days earned back what the swap lost (#2332 onward: player, queue,
editors, Home, Search, Settings, a dock that morphs into Now Playing) and ported
production's look and lowercase voice (#2459–#2484), then the desktop home with
artist of the week, the atlas and a docked queue panel (#2613–#2645).

On November 14 nate decided (#2650) that the web client moves to **Svelte** and
Expo stays for iOS and Android only, both over one plain-TypeScript `next/core`.
The reasons are in the issue: 31 `.web.ts` files had native twins, Now Playing
was built twice across about 18 PRs, and much of the web work was fighting React
Native (Safari theming #2360, screens re-rendering while music plays #2626,
scroll #2443–#2445, text-field zoom #2649). Capacitor and Swift were rejected.
#2651 froze the Expo web build and extracted the core; #2653–#2661 added the
Svelte shell, OAuth, protected streaming, owner-only music, publishing, the
portal, library, radio and embeds; #2665 made Expo native-only; #2664 exposed
the shared code through Bun workspaces; #2669 deployed an isolated preview and
#2687 added the live target for next.plyr.fm (#2663 keeps a manual hotfix path
from the frozen `next-expo` branch). November 15–16 restored parity on Svelte:
phone player and navigation (#2677), artist catalog (#2678), stats (#2675,
#2697, #2731), atlas (#2681), Jams (#2683, #2689, #2705), keyboard shortcuts
(#2668), the production track layout (#2672), settings and the You tab (#2734),
Search as a place to discover music (#2730), album covers and deletion (#2691,
#2728), and opt-in teal.fm scrobbling written from the listener's client
(#2737, #2739). Next's own NSIDs moved off `fm.plyr.stg.*` to `fm.plyr.next.*`
(#2595) and the coordinator serves from jams.next.plyr.fm (#2596).

#### the native app: App Store slot, Voice Memos, Liquid Glass (#2564, #2599–#2606, #2742–#2751, November 13–16 — TestFlight builds; not accepted on devices)

#2564 builds `next/app` into the existing plyr.fm App Store slot (bundle id
`fm.plyr`); the "existing iOS app" was the unmerged Expo client shipped once to
internal TestFlight, so there is no user migration. #2599 lets you share a
recording from Voice Memos straight into upload; on TestFlight 37 the shared
memo arrived as an empty file because the copy was not awaited before the share
payload was cleared (#2601, with a lint rule so it cannot recur). #2602–#2606
add a background upload queue with a progress toast, iOS picker types for WAV
and WebM, background uploads, auto-tagging with recommended genres (classified
once per audio source, never written by the server) and a crash fix. #2743
adopts iOS 26's native Liquid Glass tab bar and mini player; #2742, #2745,
#2747–#2751 animate active rows, keep timed comments inline, bring stats into
native navigation and teal.fm into native Settings. Simulator checks pass;
physical-device acceptance is still the cutover gate.

#### real-time Jams, personal queues and account state (#2420–#2430, #2447–#2453, #2478–#2482, November 6–12 — live on Next)

Jam rooms use a Zig/Redis WebSocket coordinator instead of polling host
snapshots (#2423, after the [research](docs/research/2026-11-05-spaces-realtime-playback.md)).
Two independent browsers passed real OAuth create/invite/join, held duplicate
Pause, host-only seeks, coordinator SIGKILL re-admission and radio handoff;
one live run measured 187 ms play delivery, an observation, not a guarantee
([audit](docs/research/2026-11-06-jams-live-verification.md)). One account's
queue synchronizes across clients with paused-playback restore (#2447–#2453,
[acceptance](docs/research/2026-11-07-personal-queue-verification.md)). The
queue and an account's settings then moved into Postgres behind one
service-auth permission requested at sign-in, with Redis as a 24 hour cache
(#2478–#2482): #2482 reverses #2330's Spaces-backed preferences, because an
account's settings are not a record anyone else needs to read.

#### publishing on Next: large uploads, processing, closed music (#2507–#2557, #2584–#2590, #2702, November 12–15)

#2507 adds recoverable public audio staging up to 1.5 GiB: the audio Worker
owns multipart bytes and recovery, the client reserves the track URI and stays
the only writer of its PDS record. Because the Worker and the Python backend
share one admission contract, #2507 and the processing executor (#2526, #2533,
#2538, #2541, #2542) reached production in `2026.1112.201458`; the executor had
been placed in `services/transcoder` on the staging transcoder, so #2557 moved
it to its own app (`plyr-next-processing`) and restored the legacy transcoder
byte-identical to `2026.1107.011947`. Admission was turned off (#2555) and back
on (#2566) once the app was up. #2517 is the client; #2528 fixed the Worker's
redirect mode; #2531–#2536 pushed a 154-part cloud fixture through. Around it:
audio replacement (#2519, #2706, #2708), private publishing and owner deletion
(#2522, #2525), albums and canonical playlist order (#2518, #2515), verified
downloads with supporter proofs bound to the payer (#2529–#2550, #2578), and
on Svelte a batch of songs uploaded and recovered as an album (#2702).

**space access became policy records** (#2584): an artist puts a track, album
or playlist in a space and opens it with any number of `fm.plyr.policy` records
(`signedIn`, `members`, `supporter`, `purchase`); passing any one reads the whole
space, and the atprotofans fallback is gone. #2587/#2588/#2590 show who can
listen and let artists close or reopen their own music from Next, after Nick
Gerakines' write-up on Space Access. **space sync**: after the AT Protocol
blog's "A Jetstream for Spaces" (November 6), #2627 forks space-stream as plyr's
syncer, #2632 adds the Zig consumer and event seam, #2634 runs it as the
plyr.fm account. Nothing reads the copy yet and no Fly process runs the
consumer.

#### production, meanwhile (`2026.1102.163235` → `2026.1115.064451`)

- **November 2**: browser telemetry forwarding is opt in and SQL telemetry
  is off (#2262–#2265); album details edit in a dialog with a live plylst
  preview (#2270, #2271); tracks delete from the edit modal everywhere
  (#2260). The year-one essay, "ready plyr one — a year of people and
  sounds", was posted November 2, with the episode rewritten around the
  people and garrison's essay credit corrected (#2257–#2259).
- **November 3** (frontend promote): the collection embed goes compact under
  500 px wide or 280 px tall; a phone in leaflet shows 3.5 rows instead of
  one (#2297).
- **November 7** (`2026.1107.011947`): radio-only exclusions (#2434). Joe
  Germuska's eleven radiator recordings leave the broadcast and stay in the
  catalog.
- **November 12** (`2026.1112.201458`): the Spaces alpha churn. ZDS 0.9
  removed the `credentialKid` field (#2511), renamed membership methods
  (#2514) and changed response signatures (#2512); both backends were fixed
  and the private-media flow passed. Poe's atmosphere dispatch and Tom
  Scanlan's Snowglobe write-up describe the same alphas from outside.
- **November 15** (`2026.1115.064451`): AddLine's upload pause is lifted
  (#2685); previously ignored firehose events and failed jobs are not
  replayed. **Merged after that release, staging only**: the hosted PDS then
  removed `getSpaceCredential`, so #2714 moved Next to `authorizeSpaceSync` and
  #2724 did the same for the legacy client with the current commit MAC tag
  (production still calls the removed method; see known issues); #2722 honors
  an unlisted first record from Next in legacy ingest and must deploy before
  the Next publisher (#2723); #2726, #2727 adjust staging tests.
- **agents answering agents**: codex's questions on `ask-claude` issues are
  answered by a workflow within minutes (#2692), swept every ten minutes with
  `needs-nate` answers relayed to nate (#2720), escalating only product and
  lexicon calls (#2738).

The plyr.fm account did not announce the rewrite. It quoted alias's wish for a
myspace-like page that autoplays a plyr track (November 8) and ran a poll on
whether song and album radios should be personalized (November 12).
thunderbird.cafe's Mixtape C60 Web Tile (October 7) builds cassettes from a
user's own plyr uploads and only works for audio stored on the user's account,
which is what Next's upload path produces.

### October 2026

See `.status_history/2026-10.md` for detailed history: the day-by-day entries
and the October 11–31 arcs (plylst and the API changes it asked for, #2250–#2254;
protected audio on the artist's PDS, #2233–#2249; Penny's `ai` label and
portable tags, #2201, #2208; three-per-artist latest, #2209; the sponsorship
prompt and AddLine's pause, #2184, #2197; the activity chart, #2191–#2220; the
sign-in page, #2186–#2195; reliability, #2161–#2241; first anniversary). The
October 1–9 arcs were covered by #2141.

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
Arcs that used to sit under current focus are in `2026-09.md` and `2026-10.md`
with their open threads; anything still live is in known issues.

## priorities

### current focus

**the Next rewrite, and its cutover** (#2650; `next/README.md`, the
[November 12 handoff](docs/research/2026-11-12-next-handoff.md) and the
[inventory](docs/research/2026-11-04-rewrite-progress-and-scope.md)): Next is
a read-only Zig appview whose index rebuilds from records, a SvelteKit web
client at next.plyr.fm, an Expo client for iOS and Android, one TypeScript
core, a playback coordinator at jams.next.plyr.fm, an audio Worker and a
processing app. Clients write `fm.plyr.*` records straight to the PDS; the
server keeps only what is rebuildable or its own named state. Live on Next:
browsing, playback, the queue, Jams, radio, settings, sign-in, the creator
portal, public and private publishing, albums and playlists, downloads.
**Not ported**: personalised and semantic discovery, private listening
history, moderation preferences; login discovery, legacy embeds and Radio
still read production services. **next**: deploy the #2722 reader, then the
Next publisher (#2723); accept the native app on physical devices; cutover
rehearsal, legacy URLs; SDK and MCP are deferred. Records Next writes are the
user's and survive any rollback, so lexicon shapes change in both apps together.

**private media is in production and still alpha-tracking** (#2233–#2249,
#2511–#2514, #2714, #2724, epic #1384): the October 29 alpha moved private
spaces to `com.atproto.space`; the November 12 alpha renamed the credential key
and membership methods (fixed in prod `2026.1112.201458`); the November 15
build removed `getSpaceCredential` (fixed on staging only). Issued credentials
run to their TTL, so removal is eventual. See [private media](docs/internal/architecture/permissioned-private-media.md)
and [protected public audio](docs/internal/architecture/protected-pds-audio.md).
Next adds policy records on top (#2584); the spec is still moving.

**still open from earlier arcs** (text in `.status_history/2026-10.md`): the
radio page is the sister-radio fork and four stations are on Ana's network
(#2097–#2107; #2102 consolidates the one-machine adapter); an upload is two
writes and one promise (#2075; compare-and-set finalize still pending);
client-side writes in the legacy app are parked (#1948–#1952), which Next makes
moot by writing from the client from the start.

### known issues

- **production's legacy Spaces client calls a method the hosted PDS removed** (#2724, November 15, staging only): the November 15 PDS build dropped `getSpaceCredential` and changed the commit MAC tag, so production private-media reads against that host fail until the next backend release carries #2724; the live private-media CI failure is #2574. #2714 fixed Next the same day.
- **an unlisted first record from Next is public in legacy search until #2722 ships** (staging only, November 15): legacy ingest now projects the unlisted intent on the initial write; the Next publisher (#2723) waits on this reader reaching production.
- **the native Next app has not been accepted on a physical device**: TestFlight builds exist (#2564, #2601 fixed a bug found on build 37) and simulator checks pass, but gestures, background playback and the share extension on a real iPhone remain the cutover gate.
- **Next's space-sync consumer runs nowhere yet** (#2632, #2634): the copy table and the sync account exist, no Fly process group runs the consumer, and closed tracks keep their metadata public until something reads the copy.
- **an owner-only work's public PDS record still names it** (#2245, October 29): #2244 hides title, policy and feed eligibility inside plyr, but the `fm.plyr.track` record for the reported track stays public on the PDS. Retracting or privately republishing it is an explicit decision, not made yet.
- **six `/rest` defects noticed while writing the Subsonic guide** (#2222, October 26, not fixed): `getArtist` loads the first 500 albums catalog-wide and then filters; `getOpenSubsonicExtensions` requires auth; `serverVersion` is `0.0.0`; album/playlist `duration` is 0; `scrobble` skips the adult/copyright filter; `getPlaylist` leaks raw exception text.
- **the moderation stream fixes are still open PRs** (#2152–#2155, October 16): replaying labels from ordered durable events, accepting standard CBOR label notifications, and keeping historical retractions from resolving current flags were prepared alongside #2149–#2151 and not merged. Also open: resuming stalled R2 reads (#2199) and signed-out hidden tags on latest (#2230).
- **optimizing a non-web-playable upload still takes ~5 minutes** (#1933): ~88 s of it is streaming the source out of R2 before ffmpeg starts. #2221 made the DM wait for it; the copy itself is unchanged.
- **native radio has not been checked on a physical iPhone** (#2101, #2104, #2105, September 28): the mute fix targets a Safari behavior (`volume = 0` ignored) verified only with a stubbed element; a reported iPhone loop at a track boundary was not reproduced on desktop; HLS Firehose and the lock-screen presentation are unverified on a device. The same gap as the live-radio item below, now for the whole page. Station switching that "plays for a while and then dies" got a fix on October 8 (#2111) written as a hope; whether it held is unreported.
- **sister-radio syndication is one Fly machine with no redundancy** (#2103 → #2102): the `plyr-radio` adapter advertises four stations from a 512 MB machine in Chicago; if it is down, native `/radio` keeps playing but Ana's directory drops the stations after health checks. Consolidation into the backend is the fix.
- **post-create hooks may run twice when the Jetstream echo and the upload task both finalize a track** (staging track 9392, September 18, unreproduced): `ingest_track_create` finalizes a pending row with a plain ORM write, not a compare-and-set, and the upload task's own `post-create hooks completed` landed 14 s after `ingest: finalized pending track` for the same row. The hooks send the notification DM and start the copyright scan. Written up in #2070.
- **a track that publishes while its worker stalls keeps a `failed` job** (#2075, intentional for now): the user is told "timed out — please re-upload" and the re-upload is rejected as a duplicate. Teaching the reaper to recognize the committed track row and complete the job is deferred.
- **PDS blob upload to blacksky.app is unverified after the nonce fix** (#2072): the September 9 failure there had the same `ReadError('')` signature as selfhosted.social, which the fix cleared in prod, but there is no test account on blacksky. #2089 (September 22) fixed a separate Blacksky problem — sign-in dying on its `repo:?` scope serialization — and does not settle this one.
- **the Blacksky sign-in shim is still needed; nothing was filed upstream** (#2089, re-checked October 10): `oauth_compat.py` rewrites `repo:?collection=…` to `repo?collection=…` in the granted scope, for the exact issuer `https://blacksky.app` and nowhere else, before the normal scope check. Blacksky's PDS (rsky) still writes the stray colon at commit `7964ffa` (October 9): its repo prefix constant is `repo:`, `to_repo_scope` appends `?` to it, and its own test asserts the result starts with `repo:?`. Bluesky's reference parser (`@atproto/oauth-scopes`, October 9) rejects a positional part alongside a named `collection`, and the Python client follows it, so without the shim every Blacksky sign-in ends in `Scope mismatch`. It loosens no permission. Remove it when rsky emits `repo?`; the decision on October 10 was not to open an upstream issue.
- **the upload-stall alert shows three job IDs plus "(+N more)"** (#2087): the triage runbook's step 5 says to use the full IDs from the alert; the rest are in Logfire. The freshness monitor's wiring lives outside this repo.
- **nothing alerts when a workflow on main is red**: `e2e private media` failed on ten consecutive pushes (September 12–18) before anyone looked. `gh run list --workflow "e2e private media"` is the check until there is one.
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

**next** (the rewrite beside production; `next/README.md`)
- appview: Zig, read-only, index rebuildable from records; Neon branch, Redis, R2
- web: SvelteKit static build at next.plyr.fm; native: Expo for iOS and Android; shared `next/core`
- services: playback coordinator (jams.next.plyr.fm), audio Worker, space-stream syncer, Rust processing app
- API at api.next.plyr.fm; deploys never promote production

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
- next: https://next.plyr.fm / https://api.next.plyr.fm (own deploys, never a production promote)

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

The [November 12 snapshot](COSTS.md#november-12-daily-driver-cost-checkpoint)
identifies $58.28/month in combined Fly/Cloudflare estimates, including $16.79
for Next. These are incomplete estimates: Postgres, copyright/AI processing and
other excluded usage still need reconciliation. The old $68 headline is a June
checkpoint, not today's total. Next has not yet established cheaper overall
operation while both stacks run. The [live dashboard](https://plyr.fm/costs)
and `COSTS.md` must be read with their coverage gaps.

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

this is a living document. last updated 2026-11-16 by the status-maintenance
pass covering November 1–16 (window opened by #2256): the October arcs and the
old current-focus text moved to `.status_history/2026-10.md`, the November 4–12
Next checkpoint entries moved verbatim to `.status_history/2026-11.md`.
