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

### September 2026

#### publishing permissions are independent of storage (#2047, #2049, #2052–#2058, September 12–14 — prod `2026.0913.023332` → `2026.0914.040530`)

**why**: an artist wanted the ordinary case — anyone listens for free, no
file download offered — and the model could not say it. rights metadata chose
storage (`write_track_rights` moved audio to private R2 and added a support
gate), the upload form mixed discovery, audience and downloads in one picker
and hid the download choice when copyright was set, and the August dial
(#1842: open / ask / supporters / off) was artist-wide. #2047 was a first cut
(a per-track override in `extra`, an `r2_private` marker); #2049 replaced its
semantics the same day. announced September 13.

**the shape**: `utilities/publishing.py` — `PublishingPolicy` is three
independent axes, *listening* (public / signed-in / supporters / owner /
space), *downloads* (open / ask / supporters / off) and *visibility* (public /
unlisted / private), with `attach_rights` a fourth choice that no longer
touches storage. protected audio is derived: anything but public listening
with open-or-ask downloads lives in private R2. defaults flow by **snapshot**:
`resolve_publishing(portal, album, track)` picks track override, then album
template, then Portal defaults, and the upload persists the policy plus a
`policy_origin`. album application is an explicit batch that keeps per-track
exceptions unless the artist ticks "replace". migration `311b4f106c90`
snapshots each track's effective policy in SQL, tags gated rows
`r2_private`, drops the old preference column, and has no downgrade; it moves
no bytes. 1,064 prod tracks, four supporter-gated, three native-private. the
SDK/CLI shipped as `0.0.1a25`; legacy upload fields are rejected outright.

**the round trip**: restricting an existing work (`_prepare_protected`)
records a revision, fetches the PDS blob and checks its CID, copies master and
a separate MP3 rendition to the gated bucket, then nulls `r2_url` and
`pds_blob_cid` and rebuilds the record before the policy commits. the reverse
did not exist: turning downloads back on left a track in private R2 with no
PDS blob. #2056 (`prepare_public`) streams the playback file back to the PDS
through the shared `upload_stored_audio`, republishes CDN copies, and keeps
the private copies because revisions can share keys; four on/off/on
regressions fail on the old code. production track 1303 was repaired through
the normal job and its 24 MB PDS blob hashed against the playback file. an
earlier repair attempt — a second application import on a prod VM — coincided
with an instance going unresponsive; use the HTTP/job path.

**#2057**: `stream_audio` and `get_audio_url` asked `can_access` for every
signed-in non-owner, inside the open DB session; a PDS without Spaces answers
400, which `private_access.py` deliberately does not cache, so every play
re-asked. a ten-line diff moves the call under the space-audience branch after
the session closes. 18-case parametrized test; 54 staging API checks and nine
production traces with zero authority calls; suite 1,752 passed.

**what cannot be undone**: previously public originals, PDS blobs, CDN caches
and old zips. "downloads off" is distribution control, not DRM — playback
still delivers bytes — and listening is still persisted in the legacy
`support_gate` column. the two loose ends (browser e2e blocked at PDS sign-in;
one artwork scan 400) are in known issues. plans:
`docs/plans/2026-09-12-publishing-access.md`, `…-staging-publishing-smoke.md`,
`…-13-publishing-release.md`; full write-ups in `.status_history/2026-09.md`.

#### three musicians who must listen before they publish (#2031–#2033, #2037–#2042, #2046, #2050, #2051, September 6–12 — prod `2026.0907.200622` → `2026.0913.023332`)

**what it is**: `services/musician-studio/` runs Moss, Kite and Reed — three
persistent agent accounts, each a JSON profile with an ethos, a seven-axis
taste vector, a curiosity scalar and four named inspirations. Every six hours
(Prefect, on the home worker, one musician per run) the composer model writes
a `MusicalPlan` and then a numpy script that must emit exactly ten seconds of
stereo audio; the script runs in a Docker container with no network, a
read-only root and a 30 s deadline, against a read-only instrument library
(#2037). Metadata and any *taste revision* are module-level constants the
host parses — a musician changes its mind by rewriting a dict literal about
itself. Peers are chosen by taste distance blended with curiosity; a kept peer
track lands in a plyr playlist named after the listener. Uploads are unlisted,
tagged `ai`, self-labeled `ai-generated`, from accounts carrying a
self-applied `bot` label (see below). Budget: $0.10 reserved per session,
$10/day, $10/month, one upload attempt per musician per day; the first full
run cost about a cent.

**the listening gate** (#2032, #2033): nate — "reading code is not
listening." No upload without a native-audio self-review of the draft, a
rendered revision, a review of that exact hash, and a peer review of it, all
through Gemini with the WAV inline and the audio-token count recorded as the
receipt. Live run `ee1b967d` did the whole cycle and Moss withheld the piece;
that is a completed study, not a failure. No track has yet been released
under the full gate.

**what the controls said** (#2039, #2041): blind calibration clips the host
knows the answer to — silence, pulses, sequential vs stacked notes, then bass
entrances crossed with melody changes. Earlier probes had a model describe
"distinct, melodic, resonant tones" in silence; the current listener passes
the isolated controls and gives questionable bass-entry answers on a mix. A
token receipt proves ingestion, not perception.

**forensics and plumbing**: Moss's published bootstrap track 1284 scheduled
chords, bass and melody in *seconds* into a mixer indexing by *samples*, so
the harmony played in the first 200 microseconds and both reviewers passed
it (#2038; peers now get plan, memory and the recording, never code). The
renderer had been discarding stderr, so weeks of failures read as "Docker
exit 1" (#2050); with the traceback kept, Reed's run turned out to be
`default_rng` called on a Generator, and draft/revision renders now get one
traceback-guided correction each (#2051; #2040 did the same for syntax). The
studio was on Gemini's free tier — `…PerDayPerProjectPerModel-FreeTier=20` —
and Google's 429 suggested retrying in five seconds on a daily quota; daily
exhaustion now stops retries (#2046). Every paid call is its own Prefect task
with cached results, so a same-day retry never pays twice (#2042). Day-by-day
log in `.status_history/2026-09.md`.

#### agents on both sides of the API, and a bot label that is the account's own word (#2022–#2025, #2036, September 5–8 — prod `2026.0905.202501`, frontend promotes September 5 and 8)

- **coding agents** (#2022): the 19 project skills moved to
  `.agents/skills/<name>/SKILL.md` with `.claude/skills` as symlinks, shared
  instructions to `.agents/AGENTS.md` with root `AGENTS.md`/`CLAUDE.md`
  resolving to it, scoped `AGENTS.md` files beside the code they govern, and
  `just setup` verifying the links. one source, two agent runtimes.
- **agents using plyr as a service** (#2024, #2025): `plyr.fm/llms.txt` is
  the canonical guide — pick a surface (HTTP, SDK, CLI, read-only MCP),
  search-inspect-then-act, "a metadata response is not proof audio played" —
  and the docs site embeds it raw instead of two copy-pasted prompts. parity
  is enforced: a client-facing OpenAPI snapshot is diffed by
  `scripts/check_client_contract.py` in pre-commit, and `interface-contracts.yml`
  runs plyr-python-client's contract and doc-example checks against this repo.
- **the bot label** (#2031, #2036): a profile shows the robot only for a
  *self-applied* ATProto `bot` label — `src` is the account's own DID, on its
  own `app.bsky.actor.profile/self`. third-party labels and name heuristics
  are ignored. the boxed "bot" badge became a small inline glyph beside the
  display name with an "Automated account" title. this is the disclosed side
  of the voluntary-label trade-off Astral's spring write-up described.

#### smaller things that reached production, September 5–13

- **edit a track where you see it** (#2030, prod `2026.0907.200622`): a pencil
  on the track page and in the portal opens one shared `TrackEditForm` in a
  native `<dialog>`; queue, footer and cache update in place, a `mutationEpoch`
  guards against stale sync responses. #2045 (frontend promote September 9)
  gave the form its scroll owner — on a 390×640 phone it grew to 1,093 px
  inside a dialog that hid overflow — and linked the record on pds.ls.
- **suggested tags for PDS-hosted audio** (#2034, #2035, prod
  `2026.0907.200622`): classification only ran when `r2_url` was set, so
  PDS-hosted tracks silently had none; the endpoint now resolves the audio URL
  the way the upload hook does (R2, presigned private R2, or `getBlob` after
  `is_safe_url`), and the editor shows unavailable/failed states with a retry.
- **interrupted PDS uploads close their streams** (#2043, prod
  `2026.0909.055649`): track 1288's Blacksky mirroring failures showed the R2
  source iterator, sometimes under the heartbeat wrapper, left open after a
  failed `uploadBlob`; an `_upload_body` context manager owns both. twelve
  transport regressions. the Blacksky failure itself is unexplained.
- **embeds caught up with the player** (#2044, prod `2026.0909.055649`): all
  five embeds on neutral surfaces, native range seek, collection lists
  scrolling above a fixed transport. URLs and station params unchanged.
- **top tracks default to the past month** (#2048, prod `2026.0913.023332`);
  an explicit saved choice still wins.

#### September 1–5 (archived)

See `.status_history/2026-09.md` for the full write-ups:
- **the player's clipped "g" exposed a track-identity collision**
  (#2026–#2028, September 5 — frontend promotes September 5, backend in prod
  `2026.0905.202501`): two uploads shared audio file `b3d77f40b53a7e57`, the
  queue persisted file IDs, and hydration collapsed them to one track — right
  audio, wrong title and artwork. the queue now saves database track IDs
  beside the legacy file IDs; a missing record is omitted, never swapped for
  a same-audio sibling. audio identity caches bytes; it is not a track's
  identity. design: `docs/internal/frontend/queue.md`.
- **the footer became spotify's, then became the only footer** (#1987–#2004,
  September 2–3 — GA in prod `2026.0902.232901`, phone follow-ups as
  frontend-only promotes September 3): one layout, the heart is the add menu,
  the classic footer and the `skip-buttons` flag deleted.
- **the ingest-blackout alert fired on a sign-up; quiet-window host rotation is
  gone** (#2006, September 3 — prod `2026.0903.222140`): rotation now needs
  evidence (plyr's own unechoed write), and `_load_cursor` stopped erasing the
  rewind.
- **the status-maintenance run knows where things landed, reads the atmosphere,
  and runs on fable 5.1** (#2008–#2021, September 4–5 — the workflow itself):
  `scripts/status_window.py` writes the window report, a pub-search research
  step writes `ecosystem_context.md`, and the model is named in every PR. this
  September 14 run is the first full run of that process; #2017 closed as
  superseded.
- **September 1–2**: skip buttons drawn until they were right (#1958–#1966)
  and the passing-comment stack (#1968–#1980), both superseded within days;
  the upload form's local file preview (#1954, #1957) and the notification bot
  surviving a revoked session (#1953), prod `2026.0901.203801`.

### August 2026

See `.status_history/2026-08.md` for detailed history:

- **client-side writes, phase 0 — shipped August 31, reverted September 1**
  (#1948–#1950, #1952): a second OAuth client meant two consent screens per
  sign-in. plan `docs/plans/2026-08-31-client-side-writes.md` stays as the
  direction; its sign-in section must be redesigned first.
- **uploads became resumable sessions** (#1947 — prod `2026.0901.065150`):
  R2 multipart with stall timeouts and retries; "slow" stopped meaning "dead".
  docs: `docs/internal/backend/resumable-uploads.md`.
- **supporter gating learns attested.network payments** (#1936, #1938, #1939):
  a neutral `validate_supporter` choke point; plyr reads and never holds a
  payments-write credential.
- **plyr never stores membership — access is the space credential** (#1930):
  `_internal/private_access.py` asks the artist's space host with the reader's
  own session; the mirror table was deleted. design:
  `docs/internal/architecture/private-media-access-list.md`.
- **the queue became a direct-manipulation surface** (#1904, #1907–#1924):
  swipe actions, keyboard rows, one reorder engine for mouse and touch. also
  **editing a track deleted its audio from the PDS** (#1904), whose 66-track
  blast radius stays in known issues.
- **August 3–24**: downloads as a per-artist policy and albums as cached zips
  (#1824–#1842); the non-modal comments panel and track-page redesign
  (#1843–#1855); the credential chain closed one step at a time
  (#1778–#1790); `file_id` is not a storage key (#1805–#1811); `/atlas`
  (#1766–#1768); the redis password and the blip that took the API down
  (#1786, #1787); the iOS lock-screen scrub unwind (#1860–#1870).

### November 2025 – July 2026

See `.status_history/`, one file per month, `2025-11.md` through `2026-07.md`.
The arcs that used to sit under current focus (radio's live source, firehose
ordering, moderation's recorded decisions, identity and discovery, `/atlas`,
the player-architecture note, downloads as a dial, the queue as a surface) are
in `2026-09.md` with their open threads; anything still live is in known issues.

## priorities

### current focus

**publishing permissions are independent of storage** (#2049, #2056, #2057):
Portal defaults, album application and per-track exceptions are in production.
Listening audience, downloads, discovery and rights metadata are separate choices.
Today “my Space members” also means private metadata; private R2 audio alone does
not hide a work. Future Space-backed storage must preserve those audience choices,
rather than turn every protected work into members-only content. Moving existing
works across Space boundaries remains a separate migration decision.

**three musicians, gated on listening** (#2031–#2051, September 6–12): Moss,
Kite and Reed compose every six hours on the home worker and may not upload
until a native-audio self-review, a revision, and a peer review of the exact
rendered hash exist. No track has passed the full gate yet; the calibration
controls say the listener hears isolated events and wobbles on a mix. **next**:
a live calibration run in the evaluation window, a human ear on anything that
does get released, and whether the app-level `bot` label should point at a
machine-readable disclosure record like the one proposed on WhiteWind in
January.

**the player is spotify's footer now, for everyone** (#1987–#2004, September 2–3 — GA in prod `2026.0902.232901`, the phone follow-ups as frontend-only promotes on September 3): one layout — art, title, heart | shuffle, previous, ±skip, play, ±skip, next, repeat over a full-width scrubber | queue, volume — and on phones the compact bar plus a scrubber row that ends with the queue button; the floating queue button and the `skip-buttons` flag are gone. the heart is the add menu (like, or add to a playlist), reading through the like owner; the phone sheet rises from above the player. the passing-comment stack (#1968–#1980) and the drawn-icon rule (judge an icon as a drawing at the largest and the shipped size, in its row) stand. nate's standing instruction for this kind of iteration: promote to prod after the staging check without asking; design changes to the phone bar pause at staging for his eyes. **next**: the fungible `/now` page (the footer as its handle on phones, the queue moving there); whether skip handlers with `seekto` scrub on a real iPhone lock screen; the drawn-iconography idea (people draw plyr's icons, doodl-style, with published icon collections and an explore page) is parked as "soon, not now".

**records are moving into the client's hands — parked until the sign-in design is redone** (plan `docs/plans/2026-08-31-client-side-writes.md`; #1948–#1950 shipped in prod `2026.0901.065150`, reverted September 1 in #1952): phase 0 made the frontend a second OAuth client and chained its consent after the cookie login, so every sign-in showed two authorization screens. the direction stands — the file an artist uploads goes in their PDS as-is, plyr indexes/mirrors/serves, and the backend stops authoring records on anyone's behalf — but the next attempt must fit inside the single existing login, with scope growing only when a feature that needs it is used. **next**: redesign how the browser gets a repo-write capability without a second flow, then phase 1 (likes).

**supporter standing is becoming a network fact, not a vendor's answer** (#1936, #1938, #1939, August 25–26 — prod `2026.0826.054059`): supporter gating recognized only atprotofans, which sees roughly one supporter record a month network-wide. attested.network — the spec ATM implements, with 861+ payer records across ~69 DIDs — is where the payments actually are, and phase 0 now reads them: `validate_supporter` sits at a neutral choke point (`_internal/supporters.py`) that owns the per-pair redis cache and tries attestations before atprotofans. The boundary with ATM is settled and deliberately lopsided — their hosted checkout owns the payer's OAuth relationship and writes the payer record; plyr only reads, and holds no payments-scoped credential of its own. **next in this arc**: Joe allowlists plyr's DID (~end of the week, after breaking API changes), then phase 1 — app registration, a webhook receiver with delivery-id dedupe, and a service-auth XRPC client. Two questions go with it: broker proofs don't pin the payer record's current content, so `subject` is the payer's word; and `payment.lookup` is public and unauthenticated, which may make the whole repo-walk unnecessary.

**the iOS lock-screen scrubber is the standing unknown** (#1860–#1870, August 15–16): ⏮/⏭ arrows, metadata, and times all work on a physical iPhone; the scrubber cannot be grabbed under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. Everything after #1860 was reverted byte-for-byte because none of it changed on-device behavior — codec/range support, artwork MIME, and call churn are ruled out, and the simulator disagrees with the phone. **next in this arc**: the deciding experiment, which is a minimal page on a physical device or Web Inspector attached to one — not another recipe (#1870).

**the credential chain, closed one step at a time** (#1778–#1790, August 7–8): asking "what do these findings compose into" rather than "is each one severe" found the session cache writing decrypted OAuth tokens *and the DPoP private key* into an unauthenticated Redis, keyed by the bearer token itself. Four steps closed — ciphertext-only cache (#1783), developer-token-only `/rest` (#1784), redis password (#1786), vendors off the uploader-controlled endpoint (#1790) — each verified against the running system rather than the diff. **next in this arc**: the scan-integrity half of #1778 (a `did:web` track's bytes are still served fresh on every request, so a clean scan does not pin what listeners hear) and the transcoder's fail-open auth (#1780), both in known issues; and auditing what a *blob* contains rather than what a field is named.

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876–#1905, epic #1384): private audio in an artist-owned permissioned space (never R2), credential-gated playback, and since August 22 an artist-named member list rather than owner-only — the `simplespace` member list on the artist's PDS decides, and plyr never stores membership: it asks the space host for a credential with the reader's session and holds that answer for the credential's lifetime (a refusal for five minutes), so a change the artist makes from any client is honored without plyr in the loop (August 23). Every sign-in now requests the private-media permission set and a spaces PDS expands it into `space:` grants at consent, so the *grant* is the capability signal (advertised `scopes_supported` never listed the dynamic scopes and hid the feature from the official alpha PDS). **open**: the cross-account e2e leg needs its `ALPHA_TEST_*` secrets; membership and supporter standing stay separate facts by design; downloads of private tracks are still refused for everyone, owner included, until a private download byte path exists. Design: `docs/internal/architecture/private-media-access-list.md`. the wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; zds tracks that branch and has rejected stale bodies twice (#1656, #1876), so drift there shows up as a failed first private upload. The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues

- **browser private-media e2e stops at PDS sign-in** (September 13): runs
  [34767184692](https://github.com/zzstoatzz/plyr.fm/actions/runs/34767184692) and
  [34785740209](https://github.com/zzstoatzz/plyr.fm/actions/runs/34785740209)
  both timed out before upload or playback because the browser blocked the
  `pds.zat.dev` authorization form under `form-action 'self'`. This predates
  #2057. Authenticated API and actual Space blob smoke passed; they do not prove
  that browser sign-in/upload works. The CSP cause remains unresolved.
- **one artwork scan returned 400** (September 13, 18:33 UTC): track 1303's
  artwork saved and its CDN read returned 200, but the background request to
  the moderation service's `/scan-image` failed. The trace did not record the
  rejection reason. Neither successful artwork storage nor a completed task
  establishes that this image was scanned; diagnosis remains open.

- **Cloudflare's JAX colo serves 100% 5xx for the R2 media domains** (observed August 27, ~17:00Z onward): users routed to Jacksonville get 500/502 on `audio.plyr.fm`/`images.plyr.fm` while every other colo is healthy — player shows `NaN:NaN`, artwork missing, page otherwise fine. Nothing to fix on our side; unacknowledged on cloudflarestatus.com. If it persists, escalate to Cloudflare support with a ray ID from an affected user (`a31cbef0bed07221-JAX`), the zone, and the colo-scoped analytics. Remove this entry once the 5xx count at JAX drains.
- **a broker proof does not pin the payer record it signs** (#1939, observed August 26): across 7 sampled live attestations, the proof's inner `cid` matches no recomputable CID of the payer record's current content, with or without `signatures`. So verification pins the *proof* and trusts the broker's `verified` status, while mutable payer fields — including `subject`, the artist being supported — are taken on the payer's word. Forging supporter standing for an arbitrary artist still costs one real broker-verified payment to someone, which is why this shipped rather than blocked. Queued as a question for ATM; if the answer is "proofs aren't meant to pin content", the public `network.attested.payment.lookup` endpoint is the better branch anyway.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **a DM that fails for a transient reason is never retried** (September 1): `_send_track_notification` correctly leaves `notification_sent` false when the send fails, but the only caller that would retry it is the Jetstream identity-update hook, which does not fire for an ordinary upload. track 1264's chat timeout on September 1 is a permanent miss; #1953 fixed the revoked-session case only. a scheduled sweep of un-notified tracks older than a few minutes is the missing piece.
- **non-web-playable uploads wait ~5 minutes to become playable in Chrome/Firefox** ([#1932](https://github.com/zzstoatzz/plyr.fm/issues/1932), [#1933](https://github.com/zzstoatzz/plyr.fm/issues/1933)): the optimize task took 4m40s and 4m52s for two AIFF uploads on August 24, ~90s of which is streaming the source out of R2 before ffmpeg starts, and the "new track" DM goes out at +3s — so a listener following the notification lands on the greyed state #1934 added rather than a player. defer the DM for `is_optimizing` tracks until the swap lands, and profile the R2→disk stream.
- **the revised private-media permission set is a re-consent event** (#1898): the `authority: "*"` reader permission only takes effect for sessions that consented after it was published, so a member added before their next sign-in cannot mint a credential yet. Credentials also live two hours by protocol with no revocation, so removal from a member list is eventual.
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **unlike may leave the track in the liked list** ([#1812](https://github.com/zzstoatzz/plyr.fm/issues/1812)): `test_cross_user_like` failed once against staging on August 9 and has passed since. Filed rather than dismissed as flaky, because the assertion describes a read-your-own-write guarantee. Ruled out: stale cache (the liked list is a direct DB query) and a failed delete (it commits before returning). Untested hypothesis: `unlike_track` deletes the row and backgrounds the PDS deletion, so a replayed like-create event could resurrect it — the #1736 family. Track deletes write a tombstone for exactly this reason; likes may have no equivalent.
- **`just backend test` runs serially, CI runs `-n auto`** ([#1815](https://github.com/zzstoatzz/plyr.fm/issues/1815)): the two take different paths through `conftest.py` — serial uses `_setup_database_direct` with no template database, no advisory lock, and no per-worker redis db. The entire parallel bootstrap only ever executed in CI, which is why #1809's bugs were invisible locally despite failing 5/5 once run CI's way. Distinct from the shared-compose-project issue below, which is about *concurrent* sessions rather than parallel workers.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see. Narrowed by #2006 (September 3): a rotation triggered by plyr's own unechoed write rewinds the cursor to before that write, so plyr's own records are replayed; foreign-client writes have no stamp, so a blind host still loses them and nothing rotates for them.
- **parallel agent sessions share one test database** (found August 9): `backend/tests/docker-compose.yml` has no `name:` field, so compose derives the project name from the directory — every checkout/worktree of this repo maps to the same `tests-test-db-1`/`tests-test-redis-1` containers, and two sessions running tests concurrently silently recreate each other's schemas (see the #1801 technical notes for the evening this cost). A `name:` derived from the checkout path, or `COMPOSE_PROJECT_NAME`, would isolate them.
- **PDS-hosted audio is still scanned from a mutable source** ([#1778](https://github.com/zzstoatzz/plyr.fm/issues/1778), narrowed by #1790): the SSRF half is closed — `is_safe_url` now validates the endpoint where a miniDoc enters the system and at both `pds_blob_url` construction sites, and vendors are no longer pointed at the uploader-controlled URL. What remains is the scan-integrity half: a `did:web` track's bytes are served by the user's own host on every request, so a clean copyright scan does not pin what listeners later hear. Pinning the scan to `pds_blob_cid` means fetching and hashing blobs on the track-creation hook — the path #1519 deliberately made non-blocking — so it is a real change, not a validation tweak.
- **the transcoder's auth fails open** ([#1780](https://github.com/zzstoatzz/plyr.fm/issues/1780)): with `TRANSCODER_AUTH_TOKEN` unset it logs a warning and accepts every request, and the app has a public IP. Currently latent — the secret is set and the app is suspended — but `services/moderation/src/auth.rs` returns `SERVICE_UNAVAILABLE` in the same situation, so the transcoder is the outlier and this is a consistency fix.
- **CORS permits every HTTPS origin with credentials** (from #208, closed Feb 2026): `allow_origin_regex` resolves to `^(https://.+|http://localhost:\d+|null)$` with `allow_credentials=True`. Harmless today only because the session cookie is same-site and `SameSite=Lax` is carrying the entire defense — it would become a full CSRF-and-read hole the moment anyone sets `samesite="none"` for an embed, or moves the API off the `plyr.fm` registrable domain. #208's closing summary claimed "CORS validation" and its own item 1 (magic-byte MIME validation) never shipped; uploads still trust the client's `Content-Type`. Worth treating as a lesson about closing security issues against a summary rather than the running system.
- **staging's error-level `SELECT neondb` spans are benign and staying** (August 8; full diagnosis in `.status_history/2026-08.md`): staging's Neon compute suspends after 5 minutes idle while `pool_recycle` is 1800s, so the next checkout gets a dead connection and the OTel instrumentation stamps an `ERROR` span with no message. `pool_pre_ping` recovers transparently — all 95 traces had a succeeding root span. `DATABASE_POOL_RECYCLE=240` was tried and unset again: forcing a reconnect every 240s starved concurrent uploads behind the 3-per-artist gate and timed out three album integration tests. The correct fix, if it ever matters, is disabling scale-to-zero on the staging compute.
- **nothing records listening over time** (August 5 accounting; retention figure corrected August 9): `play_count` is a counter on the track row, so plays-per-day exists only inside Logfire's retention window — which is **far shorter than the 14 days assumed here**: on August 9 the earliest record in the project was the same day at 06:12 (see [#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)). The history before that is unrecoverable. Every day without an append-only play-events table (or a daily `/stats` snapshot) is another day of curve we cannot draw later. Deliberately not built yet — it is new surface, and the shape of it is undecided.
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
- **skip handlers together with `seekto` have never been on a physical iPhone** (#1958, September 1; now true for everyone since the #2000 GA, prod `2026.0902.232901`): `seekbackward`/`seekforward` are registered next to the existing `seekto`, a combination none of the #1860–#1869 recipes tried, and iOS shows ±skip in place of ⏮/⏭ because of it. whether the lock-screen scrubber behaves differently with both is nate's phone to answer — and the flag that used to limit the blast radius is gone.
- **the iOS lock-screen scrubber cannot be dragged in the real app** ([#1870](https://github.com/zzstoatzz/plyr.fm/issues/1870)): metadata, times, and ⏮/⏭ all work; the scrubber never grabs on a physical iPhone under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. the deciding experiment — a minimal page on a physical phone, or Web Inspector attached to the device — has not run yet; the code is deliberately parked at the #1860 state.
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- drawn iconography: let people draw plyr's own icons doodl-style — slottable icon components, published icon collections, an explore page for them (nate, September 1: "soon, not exactly now"; the sibling repo `doodl` is the reference: `tech.waow.doodl.iconset` maps UI slots to drawing strongRefs)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (#958)
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

this is a living document. last updated 2026-09-14 (status maintenance, window
September 4–14): the publishing-access arc consolidated (#2047–#2058), the
musician studio's September 6–12 log and the September 2–5 arcs moved to
`.status_history/2026-09.md`, agent discovery and the smaller fixes recorded.
