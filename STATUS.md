# plyr.fm - status

Start here for the next agent: `next/README.md`, the
[Svelte decision](https://github.com/zzstoatzz/plyr.fm/issues/2650) and the
[November 12 handoff](docs/research/2026-11-12-next-handoff.md).

## where things stand (November 23)

Two apps run side by side. **Production plyr.fm** (`backend/`, `frontend/`) is
the Python/SvelteKit app; its latest release is `2026.1122.040102`. **Next**
(`next/`) is the rewrite that replaces it: a read-only Zig appview at
api.next.plyr.fm, a SvelteKit web client at next.plyr.fm, an Expo client for
iOS on TestFlight, one TypeScript core, and its own coordinator, workers,
labeler and Osprey. Clients write `fm.plyr.*` records straight to the user's
PDS; the appview projects only what it can verify. Next deploys from `main` on
merge and never promotes production; the window report lists Next-only PRs as
`docs only` because they touch neither `backend/` nor `frontend/`. "Live on
Next" below means next.plyr.fm, never plyr.fm. The cutover has not run.

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

About 720 PRs merged between November 1 and 23, nearly all under `next/`.
Production shipped eight backend releases (`2026.1102.163235` →
`2026.1122.040102`) and twelve frontend promotes. The verbose checkpoint
entries the Next sessions wrote into this file as they landed (November 4–12)
are preserved verbatim in `.status_history/2026-11.md`.

#### the Next client went to Expo on November 3 and back to Svelte for the web on November 15 (#2280–#2331, #2650–#2687 — next.plyr.fm; production untouched)

Next's shape on November 2: Zig backend, web client and audio worker under
`next/` (#2291); a read-only appview with client-owned OAuth and direct PDS
writes (#2281–#2284); a blob mirror verified by CID (#2285–#2287); ingest from
jetstreams (#2292); the real `fm.plyr.*` records (#2299); cover art as an
`imageBlob` on the artist's PDS (#2306). On November 3, #2331 replaced the
SvelteKit client with one Expo / React Native app for iOS, Android and web;
the next ten days earned back what the swap lost (#2332 onward), ported
production's look and lowercase voice (#2459–#2484) and built the desktop home
(#2613–#2645). On November 14 nate decided (#2650) that the web client moves
to **Svelte** and Expo stays for iOS and Android, over one plain-TypeScript
`next/core`: 31 `.web.ts` files had native twins, Now Playing was built twice
across about 18 PRs, and much of the web work was fighting React Native.
#2651 froze the Expo web build and extracted the core; #2653–#2661 added the
Svelte shell, OAuth, protected streaming, publishing, portal, library, radio
and embeds; #2687 flipped next.plyr.fm to Svelte on November 15 and
#2668–#2740 restored parity over two days. Next-only NSIDs moved to
`fm.plyr.next.*` (#2595).

#### cutover work: nothing on Next reads production any more (#2773–#2809, #2838–#2848, #2850–#2852, #2877, #2949–#2973, November 18–23 — live on Next)

Reads are XRPC only, `fm.plyr.unspecced.*` (#2802–#2809; nothing is
published as a schema record). Production's most-linked paths keep working
once api.plyr.fm points here: `/audio/{file_id}` and `/tracks/{id}` redirect
(#2958), `/oembed` and link preview cards come from an edge worker (#2838,
#2841, #2843), terms, privacy, `robots.txt`, a sitemap and redirects for the
prod pages Next folded away exist (#2956). Embeds, radio plays and iOS sign-in
stopped calling prod's API (#2949); the atlas is built from Next's own
Postgres with pgvector (#2952). **Radio is served by the Zig API** (#2840,
#2844–#2847): the same five stations, a rotation pinned per four-hour period
so deploys cannot reshuffle it; listener presence is not ported. The
`plyr-radio` sister-network adapter is pinned to read Next at cutover (#2848,
prod `2026.1122.040102`; deploying it is the manual `deploy-radio` workflow).
Prod's play counts are imported (#2850–#2852, #2954): Next had shown ~436
plays against prod's ~19.7k. next.plyr.fm deploys on merge (#2877). **The
catalog diff** (#2966–#2973, daily until the cutover) buckets every prod track
by where it stands on Next and asks each missing record's PDS whether it still
exists. It found 71 tracks on indexed accounts that Next had rejected: prod
wrote `audioBlob`s past the track lexicon's own limits (about 60 over 100 MB,
eight typed `video/*` phone recordings). Records cannot be rewritten without
each artist's auth, so Next keeps the record and plays from `audioUrl` (#2970,
#2972). On November 23 the ingester sat stopped from 06:10Z on one closed
track's event (#2960); the deploy now starts a stopped worker and fails if it
won't run (#2959).

#### Next's own moderation (#2794–#2799, #2817, #2821, #2914–#2919, #2962, November 19–23 — live on Next)

Next had only copied prod's labels. Now: an append-only moderation log with
`createReport` for anyone signed in and queue/decision methods for operators,
the actor being the verified JWT issuer rather than a claim (#2794); **its own
labeler**, signing labels through zat and serving `queryLabels` (#2796, #2799),
after zat devlog 017 shipped the label client; a report-a-track sheet and a
`/moderation` review queue on web (#2797); ROOST's Osprey running prod's
copyright plays-through rule over Next's index every ten minutes (#2798).
After atproto's "moderation in spaces" post, a takedown closes the artist's
gated spaces and artists can remove a reader (#2817, #2821). Tracks written
straight to a PDS by any client are mirrored and scanned (#2914); every cover
is checked against the image policy (#2916–#2919, #2962). Until cutover the
labeler signs as `did:web:api.next.plyr.fm` and Osprey scans only audio Next
stored itself.

#### audio and covers on the artist's PDS (#2880, #2884, #2920, #2924, #2925, November 22–23 — live on Next)

A tester on a bsky-hosted PDS (woody.fm's Bog Bender) uploaded a lossless file
and nothing of the audio landed on their PDS: the plyr.fm-storage route was
hard-coded to `audioUrl`-only records. Now every open upload up to 100 MB puts
the original on the PDS as `audioBlob` beside the mp3's `audioUrl`, as prod did
(#2920). A one-time sheet after sign-in and a card on the you page offer to
**move audio that isn't on your PDS onto it** (#2924 web, #2925 iOS): prod-era
plyr.fm-storage tracks, earlier Next uploads, and records whose blob the PDS
no longer serves, restored only from a copy whose hash matches the CID; over
100 MB stays on plyr.fm. Covers load from Next's own image worker in small
WebP sizes, kept once fetched, after zds garbage-collected nate's cover
(#2880, #2884). thunderbird.cafe's Mixtape Burndown (November 21) reads
exactly these records and blobs from the account's own PDS.

#### selling music, and who can listen (#2584, #2795, #2842, #2845, #2869, #2936, #2957, November 14–23 — live on Next)

Space access is policy records (#2584): an artist opens a space with
`signedIn`, `members`, `supporter` or `purchase` policies and passing one reads
the whole space. **Sell your music** (#2795): a support link and a buy link
per release, a buy pill beside play, and a track closed to you lists every way
in, with a note that buying elsewhere doesn't unlock it on plyr yet; buy links
are a link only, no price (#2869). Upload is one form with **who can listen**:
open, or closed with ways in (supporters, a price, anyone signed in, people
you pick); closed with no ways is only-you, and the audio enters the space
before the public record exists (#2842, #2845). Who can listen has its own
page with a people picker on web and iOS (#2936, #2957). Hilke Ros's
indiemusi.ch alpha proposes the same grant-record shape.

#### listening: chapters, comments over the cover, the listening room queue (#2623, #2772, #2775–#2777, #2801, #2806, #2835, #2787, #2833, #2927, #2860–#2865, November 15–23 — live on Next)

A description with three or more ordered timestamps becomes a tracklist
(#2623), and the "now:" line is a **chapter wheel** you hold and drag (#2772)
— after bnb.im asked on November 18 for tagging sections of a mix with
specific songs and nate replied with a work-in-progress video. Play next,
hold-to-drag and swipe in the queue (#2775, #2777). The queue became a
**listening room** (#2806) over plain-SQL suggestions from shared likes, lists
and tags (#2801). Timed comments rise over the cover as chips with a synced
comments view (#2835), only when the artist opted in (#2761, #2762). teal.fm
"listening now" flair on artist pages (#2787, #2788). Radio: the firehose
broadcast plays and iOS radio has the lock screen (#2833), stations have
shareable links (#2927, #2934). Also pull to refresh (#2860–#2865), the you
page as a home base (#2866), desktop home and immersive pages (#2879, #2883,
#2887), the stats redesign (#2947), multi-tag browsing (#2915, #2933).

#### the native app (#2564, #2599–#2606, #2742–#2751, #2765, #2774, #2808, #2897, November 13–22 — TestFlight builds)

`next/app` builds into the existing plyr.fm App Store slot (#2564). A Voice
Memo shares straight into upload (#2599; on TestFlight 37 it arrived empty,
#2601). Background uploads with a Lock Screen Live Activity (#2602–#2606,
#2808); iOS 26 Liquid Glass tab bar (#2743); JS-only fixes ship over the air
(#2765). EAS cloud builds ran out on November 16, so builds run on nate's Mac
and upload straight to Apple, and "shipped" means App Store Connect shows the
build to testers (#2774). A public TestFlight link exists (#2897). Simulator
and nate's phone are the only device acceptance recorded.

#### real-time Jams, personal queues, account state (#2420–#2430, #2447–#2453, #2478–#2482, November 6–12 — live on Next)

Jam rooms use a Zig/Redis WebSocket coordinator (#2423,
[audit](docs/research/2026-11-06-jams-live-verification.md)); one account's
queue synchronizes across clients (#2447–#2453,
[acceptance](docs/research/2026-11-07-personal-queue-verification.md)); queue
and settings live in Postgres behind one service-auth permission, Redis as a
24 hour cache (#2478–#2482), reversing #2330's Spaces-backed preferences.

#### publishing on Next: large uploads, processing, closed music (#2507–#2557, #2702, #2811–#2813, #2923, November 12–23)

#2507 adds recoverable public audio staging up to 1.5 GiB: the audio Worker
owns multipart bytes and recovery, the client stays the only writer of its PDS
record. The Worker and the Python backend share one admission contract, so
#2507 and the processing executor (#2526–#2542) reached production in
`2026.1112.201458`; #2557 moved the executor to its own app and restored the
legacy transcoder byte-identical, and #2923 rewrote it in Zig, the last Rust
on Next. A track is published once its audio can stream (#2811–#2813). Around
it: audio replacement (#2519, #2706, #2708), private publishing and owner
deletion (#2522, #2525), albums and canonical playlist order (#2518, #2515),
verified downloads with supporter proofs bound to the payer (#2529–#2550,
#2578), and the space-stream syncer run as the plyr.fm account (#2627–#2634).

#### production, meanwhile (`2026.1102.163235` → `2026.1122.040102`)

- **November 2–3**: browser telemetry forwarding is opt in and SQL telemetry
  is off (#2262–#2265); album details edit in a dialog with a live plylst
  preview (#2270, #2271); tracks delete from the edit modal everywhere
  (#2260); the collection embed goes compact on phones (#2297, promote). The
  year-one essay, "ready plyr one", was posted November 2 (#2257–#2259).
- **November 7** (`2026.1107.011947`): cover art as `imageBlob` on the
  artist's PDS (#2306); radio-only exclusions (#2434): Joe Germuska's eleven
  radiator recordings leave the broadcast and stay in the catalog.
- **November 12** (`2026.1112.201458`): the Spaces alpha churn. ZDS 0.9
  removed `credentialKid` (#2511), renamed membership methods (#2514) and
  changed response signatures (#2512). Poe's atmosphere dispatch and Tom
  Scanlan's Snowglobe write-up describe the same alphas from outside.
- **November 15** (`2026.1115.064451`): AddLine's upload pause is lifted
  (#2685); previously ignored firehose events are not replayed.
- **November 21** (`2026.1121.015725`): the hosted PDS had removed
  `getSpaceCredential`, so the legacy Spaces client uses `authorizeSpaceSync`
  and the current commit MAC tag (#2724; #2714 for Next); legacy ingest honors
  an unlisted first record from Next (#2722, unblocking the Next publisher
  #2723); the profile record keeps other clients' fields (#2759); **teal.fm
  now-playing status follows the player** (#2822): set on play, re-set after
  a seek, ended on pause, never for private or gated tracks.
- **November 22** (`2026.1122.040102`): plyr-api stops exporting ~120k metric
  points a day to Logfire (#2853); the radio adapter pin (#2848).
- **agents answering agents**: `ask-claude` issues are answered by a workflow
  within minutes (#2692, #2720, #2738).

The plyr.fm account did not announce the rewrite; it ran a poll on song and
album radios (November 12). nate's replies did the telling: a work-in-progress
video to bnb.im (November 18), the teal status note (November 21), and on
November 23 an exchange with minormobius about Duende Radio, where
next.plyr.fm/radio indexing sister radios came up.

### October 2026

See `.status_history/2026-10.md` for detailed history: the day-by-day entries
and the October 11–31 arcs (plylst, #2250–#2254; protected audio on the
artist's PDS, #2233–#2249; Penny's `ai` label and portable tags, #2201, #2208;
three-per-artist latest, #2209; the sponsorship prompt and AddLine's pause,
#2184, #2197; the activity chart, #2191–#2220; the sign-in page, #2186–#2195;
reliability, #2161–#2241; first anniversary). October 1–9 was covered by #2141.

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
Arcs that used to sit under current focus are in `2026-09.md` and `2026-10.md` with their open
threads; anything still live is in known issues.

## priorities

### current focus

**the Next rewrite, and its cutover** (#2650; `next/README.md`, the
[November 12 handoff](docs/research/2026-11-12-next-handoff.md), the
[inventory](docs/research/2026-11-04-rewrite-progress-and-scope.md)): live on
Next are browsing, playback, the listening-room queue, Jams, radio, settings,
sign-in, the portal, public and closed publishing, albums and playlists,
downloads, selling, reports and a review queue, its own labeler and Osprey,
link previews, legal pages and the legacy redirects; nothing on Next reads
production since November 23. **Not ported**: personalised discovery, private
listening history, radio listener presence, Subsonic, in-app account deletion.
**Cutover steps, in `next/docs` and the PR bodies**:
flip api.plyr.fm and plyr.fm DNS to Next; run `deploy-radio` so the sister
adapter reads Next; move the labeler to moderation.plyr.fm's DID and key
(#2796); widen Osprey's scope past Next-stored audio (#2798); run the final
play import (#2850); re-run the catalog diff and read its buckets (#2971);
publish the docs site from the `next/docs` placeholders (#2800); retire
turbopuffer and the legacy atlas build. Then the Next publisher (#2723), now
that #2722 is in production. Records Next writes are the user's and survive
any rollback, so lexicon shapes change in both apps together.

**private media is in production and still alpha-tracking** (#2233–#2249,
#2511–#2514, #2724, #2574, epic #1384): the November 12 alpha renamed the
credential key and membership methods (prod `2026.1112.201458`); the
November 15 build removed `getSpaceCredential` (prod `2026.1121.015725`).
Poe's atmosphere dispatch (November 16) dates the Spaces public beta to
December 1 with no breaking changes expected after it. Issued credentials run
to their TTL, so removal is eventual. Next adds policy records on top (#2584)
and a draft `fm.plyr.release` lexicon awaits nate's design review (#2628).
See [private media](docs/internal/architecture/permissioned-private-media.md)
and [protected public audio](docs/internal/architecture/protected-pds-audio.md).

**still open from earlier arcs** (text in `.status_history/2026-10.md`): the
radio page is the sister-radio fork and four stations are on Ana's network
(#2097–#2107; #2102 consolidates the one-machine adapter, which the Zig radio
and #2848 move toward); an upload is two writes and one promise (#2075;
compare-and-set finalize still pending); client-side writes in the legacy app
are parked (#1948–#1952), moot on Next, which writes from the client.

### known issues

- **the cutover has not run, and Next's identity is interim until it does**: the labeler signs as `did:web:api.next.plyr.fm` (#2796) and Osprey scans only audio Next stored itself (#2798); the `plyr-radio` adapter still reads production until `deploy-radio` runs (#2848); the atlas on Next is empty until `next-build-atlas` has run once (#2952).
- **the catalog diff still has buckets to read** (#2966–#2973, daily): after #2970 the remaining missing records are accounts Next never saw or cannot reach, prod-only rows with no PDS record, and covers missing on Next. The job summary is the record; no count after November 23 has been written down.
- **Next's ingester stopped for about four hours on November 23** (#2959, #2960): one closed track's event hit a check constraint; the jetstream checkpoint resumed from where it stopped, and the deploy now restarts and verifies the workers. A second cause would stop it the same way until someone reads the deploy's log.
- **the native Next app has only nate's phone and the simulator as acceptance**: TestFlight builds exist, a public link exists (#2897), and no outside tester's report is recorded.
- **next.plyr.fm's privacy page says account deletion is by email** (#2956): Next has no in-app account delete.
- **production's `fm.teal.actor.status` write needs a session that consented after the teal switch requested it** (#2822): older sessions skip the status silently and keep scrobbling.

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
- **a broker proof does not pin the payer record it signs** (#1939, observed August 26): across 7 sampled live attestations, the proof's inner `cid` matches no recomputable CID of the payer record's current content, with or without `signatures`. So verification pins the *proof* and trusts the broker's `verified` status, while mutable payer fields — including `subject`, the artist being supported — are taken on the payer's word. Forging supporter standing for an arbitrary artist still costs one real broker-verified payment to someone, which is why this shipped rather than blocked. Queued as a question for ATM; if the answer is "proofs aren't meant to pin content", the public `network.attested.payment.lookup` endpoint is the better branch anyway.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **a DM that fails for a transient reason is never retried** (September 1): `_send_track_notification` correctly leaves `notification_sent` false when the send fails, but the only caller that would retry it is the Jetstream identity-update hook, which does not fire for an ordinary upload. track 1264's chat timeout on September 1 is a permanent miss; #1953 fixed the revoked-session case only. a scheduled sweep of un-notified tracks older than a few minutes is the missing piece.
- **the revised private-media permission set is a re-consent event** (#1898): the `authority: "*"` reader permission only takes effect for sessions that consented after it was published, so a member added before their next sign-in cannot mint a credential yet. Credentials also live two hours by protocol with no revocation, so removal from a member list is eventual.
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see. Narrowed by #2006 (September 3): a rotation triggered by plyr's own unechoed write rewinds the cursor to before that write, so plyr's own records are replayed; foreign-client writes have no stamp, so a blind host still loses them and nothing rotates for them.
- **an unmirrored `did:web` track is still scanned from a mutable source** ([#1778](https://github.com/zzstoatzz/plyr.fm/issues/1778), narrowed by #1790): the SSRF half is closed — `is_safe_url` now validates the endpoint where a miniDoc enters the system and at both `pds_blob_url` construction sites, and vendors are no longer pointed at the uploader-controlled URL. What remains is the scan-integrity half: a `did:web` track's bytes are served by the user's own host on every request, so a clean copyright scan does not pin what listeners later hear. Pinning the scan to `pds_blob_cid` means fetching and hashing blobs on the track-creation hook — the path #1519 deliberately made non-blocking — so it is a real change, not a validation tweak.
- **the transcoder's auth fails open** ([#1780](https://github.com/zzstoatzz/plyr.fm/issues/1780)): with `TRANSCODER_AUTH_TOKEN` unset it logs a warning and accepts every request, and the app has a public IP. Currently latent — the secret is set and the app is suspended — but `services/moderation/src/auth.rs` returns `SERVICE_UNAVAILABLE` in the same situation, so the transcoder is the outlier and this is a consistency fix.
- **CORS permits every HTTPS origin with credentials** (from #208, closed Feb 2026): `allow_origin_regex` resolves to `^(https://.+|http://localhost:\d+|null)$` with `allow_credentials=True`. Harmless today only because the session cookie is same-site and `SameSite=Lax` is carrying the entire defense — it would become a full CSRF-and-read hole the moment anyone sets `samesite="none"` for an embed, or moves the API off the `plyr.fm` registrable domain. #208's closing summary claimed "CORS validation" and its own item 1 (magic-byte MIME validation) never shipped; uploads still trust the client's `Content-Type`. Worth treating as a lesson about closing security issues against a summary rather than the running system.
- **the `firehose` station has no recorded fallback** (#1741): waow.tech's sonification segments are `unlisted` and the radio corpus is public-only, so when the broadcast stops the station has nothing to play. It now says "off air" and keeps the tuner reachable (#1744) instead of stranding anyone, but publishing some segments publicly is the only thing that gives it real fallback material — a content decision, not a code one.
- **the rev guard has a one-event window per track** (#1736): `atproto_record_rev` starts `NULL`, and ingest applies-and-learns rather than rejecting when it has no baseline — rejecting would silently drop legitimate edits from other clients. So each track's first update after the release is itself unordered. 6 of 1005 tracks have a rev as of August 9; the rest acquire one when they are next edited. Backfilling from each PDS record would close the window.
- **comment and list updates are still unordered** (#1736): the same last-writer-wins defect exists in `ingest_comment_update` and `ingest_list_update`. Only the track path was fixed, because that is the one that can strand audio bytes.
- **`_reference_count` cannot see `r2_url`** (#1735/#1736): the refcount that guards deletion matches `file_id`-shaped columns, so it cannot protect a row whose `r2_url` and `file_id` name different objects. `prune_revisions` now compensates locally; the general fix belongs in `_MEDIA_REFERENCES`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet.
- **the account-status reconciliation script has not been run against prod** (#1729): a dry run reports 5 artists whose `account_status` reason is `NULL` and would be filled in, with zero flags changed. Until it runs, those rows say an artist is hidden without saying why.
- **33 subjects await a call in the review queue** (recounted October 2, after the first decisions): 11 leaked or unreleased recordings of another artist from one account, where de-listing is undecided; about 16 that need someone to listen, mostly claimed covers; 3 unofficial remixes, waiting on a policy; and track 64, which reads as a mix but carries user report #5 from @vicwalker.dev.br. Still unset: how unofficial remixes are treated, and whether a whole-track match from an unrelated account is enough to label without listening.
- **uploaders of 17 wrongly flagged tracks were never told** (October 1): the old rule showed them a copyright badge on their own track in the portal, some for two months. The flags are cleared; no notice was sent, by decision that day. One uploader replaced the audio four times while flagged.
- **two tracks cannot be scanned**: AuDD cannot extract audio from track 123's 19 KB file, and track 930 has sat in `pending` since April with an `r2_url` that returns 404. Three private tracks are unscanned by design.
- **a review item cannot be annotated without closing it**: an internal mark is an `acknowledged` event with a reason, so undecided items carry no note. A fan-taping mark published through the labeler has been raised as an idea and is not built.
- **copyright spend is not on the live cost feed**: AuDD is computed from hardcoded plan constants and Claude image moderation is tracked nowhere. The five-minute labeler poll (`sync_copyright_resolutions`) also likely keeps the moderation database from scaling to zero; the Neon side is unconfirmed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
- **skip handlers together with `seekto` have never been on a physical iPhone** (#1958, September 1; now true for everyone since the #2000 GA, prod `2026.0902.232901`): `seekbackward`/`seekforward` are registered next to the existing `seekto`, a combination none of the #1860–#1869 recipes tried, and iOS shows ±skip in place of ⏮/⏭ because of it. whether the lock-screen scrubber behaves differently with both is nate's phone to answer — and the flag that used to limit the blast radius is gone.
- **the iOS lock-screen scrubber cannot be dragged in the real app** ([#1870](https://github.com/zzstoatzz/plyr.fm/issues/1870)): metadata, times, and ⏮/⏭ all work; the scrubber never grabs on a physical iPhone under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. the deciding experiment — a minimal page on a physical phone, or Web Inspector attached to the device — has not run yet; the code is deliberately parked at the #1860 state.
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

**backend** (production)
- language: Python 3.11+; framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless); storage: Cloudflare R2 (CDN via custom domains)
- background tasks: docket (Redis-backed); hosting: Fly.io (2x shared-cpu VMs)
- observability: Pydantic Logfire (spans and logs; metrics off since #2853)
- auth: ATProto OAuth 2.1

**frontend** (production)
- framework: SvelteKit with Svelte 5 runes; runtime: Bun; hosting: Cloudflare Pages
- interface: persistent player and queue, search and discovery, publishing tools, shared listening, and embeds
- styling: vanilla CSS with shared design tokens

**next** (the rewrite; `next/README.md`, `next/AGENTS.md`)
- appview: Zig on httpz, read-only, XRPC `fm.plyr.unspecced.*`; index rebuildable from records; Neon branch with pgvector, Redis, R2
- ingest: jetstream (stream.waow.tech first), CID re-hashed before projection; blob mirror; catalog reconcile on parser changes
- web: SvelteKit static build at next.plyr.fm with an edge worker for link previews, oembed, robots, sitemap, redirects; native: Expo for iOS (TestFlight, OTA updates); shared `next/core`
- services: playback coordinator (jams.next.plyr.fm), audio Worker, image worker, Zig processing app, space-stream syncer, Osprey rules worker, its own labeler
- deploys from `main` on merge (`deploy-next*.yml`, `deploy-web-next.yml`); never promotes production

**deployment**
- ci/cd: GitHub Actions
- staging: backend (Fly.io) and frontend (Cloudflare Pages) deploy from `main`
- production: separate promote via `just release` (backend/mixed) or `just release-frontend-only` (frontend only); see `docs/internal/deployment/environments.md`
- migrations: automated via fly.io release_command

**what's working in production** (the full checklist as of October 31 is in
`.status_history/2026-10.md`; the public feature docs are at docs.plyr.fm)
- ATProto OAuth 2.1 sign-in, multi-account, HttpOnly sessions, developer tokens
- upload (streaming, resumable, lossless AIFF/FLAC with deferred MP3 rendition), PDS blob storage, cover art and protected audio on the artist's PDS
- player, queue, repeat-one, "keep playing", jams, radio (sister-radio fork), embeds, Subsonic `/rest`, timed comments, likes, play counts and `track_plays` history
- albums and playlists as ATProto list records, composite covers, edge artwork renditions, cached album zips, download policies, supporter gating
- search (keyword + CLAP mood), genre auto-tags, portable track tags, teal.fm scrobbling and now-playing status
- moderation on signed labels: copyright de-listing, adult audio, account-level `ai`, indexing decisions, event log and public decision posts

**deployment URLs**
- production frontend: https://plyr.fm
- production backend: https://api.plyr.fm
- staging: https://stg.plyr.fm / https://api-stg.plyr.fm
- next: https://next.plyr.fm / https://api.next.plyr.fm (own deploys, never a production promote)

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase; the Zig rewrite in `next/` is the second answer

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming); S3-compatible API, integrated CDN

**why async everywhere?**
- I/O-bound workload: most time spent waiting on network/disk; PRs #149-151 eliminated all blocking operations

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

this is a living document. last updated 2026-11-23 by the status-maintenance
pass covering November 1–23 (window opened by #2256): the October arcs and the
old current-focus text moved to `.status_history/2026-10.md`, the November 4–12
Next checkpoint entries moved verbatim to `.status_history/2026-11.md`.
