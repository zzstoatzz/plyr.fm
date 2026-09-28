---
title: "radio and listener presence"
---

# native radio

`/radio/[[station]]` mounts the actual SolidJS listener page from our
[plyr-radio fork](https://tangled.org/zzstoatzz.io/plyr-radio), including its CRT
artwork, controls, tuner, queue, and responsive layout. The source is vendored
under `frontend/vendor/sister-radio`; `UPSTREAM.md` records its exact revision.
This replaces the Svelte approximation initially shipped in #2097.

`SisterRadio.svelte` connects the page to plyr.fm's persistent player, catalog
schedule, cookie-authenticated listener snapshots, and existing likes action.
The Solid host uses a shadow root to contain upstream CSS; host variables inherit
the account's font, accent, and light/dark appearance. It creates no audio element,
second session, upload path, or outside station directory request. Sensitive
artwork remains hidden unless allowed by the existing preference.

The five station slugs and sampling policies stay in `api/radio/stations.py`.
The client requests `/radio/state?catalog_only=true`, excluding the external
firehose broadcast. The default public state API retains its existing live-stream
behavior for older clients. No database migration or new Fly service is needed.

The standalone fork retains the signed station identity and PDS prototype. This
hosted UI does not announce itself to a sister directory or share presence with
other radios. Deploying that bridge remains separate work. Only our stations are
listed. Upstream chat, equalizer, waveform, and stream-overlay controls are hidden
because this host does not supply those features; the heart uses plyr's existing
like action, and the pop-out opens the existing native radio embed. See the
[research](../../research/2026-09-27-ana-radio-integration.md) for protocol findings.

## updating the fork

Keep reusable integration changes in the fork's `RadioPage.tsx`,
`SongCoverThumb.tsx`, and `shared/lib/integration.ts`. Host mode is optional, so
standalone playback remains supported. Build the fork, pin its commit, and copy
the listener page's dependency closure into the vendor directory. The host entry,
CSS token mapping, and native state adapter belong to plyr.fm. Preserve upstream
formatting and use `just loq-relax` for vendored source limits.

Run the real mounted Solid component tests in `src/lib/sister-radio.test.ts`
after updates. They exercise playback delegation, station selection, avatar and
cover rendering, and the absence of standalone network requests/audio elements.

## presence contract

- `GET /radio/{station}/listeners` returns `{count, listeners}`. Public profiles
  contain `did`, `handle`, `display_name`, and `avatar_url`; at most 24 are hydrated.
  Counts include anonymous connections and deduplicate authenticated accounts.
- `WS /radio/{station}/listen` accepts the configured frontend origin (and local
  HTTP origins in debug mode). Identity comes exclusively from the HttpOnly
  `session_id` cookie. A missing cookie means anonymous; an invalid cookie fails.
- The server acknowledges with `{"type":"listening"}`. Send the text `ping` every
  20 seconds. No other payload or identity claim is accepted. Sessions are checked
  again on each heartbeat; revoked sessions close with code 4001.
- Redis stores station-scoped expiring connection leases. A socket idle for 45
  seconds closes; crashed processes leave leases that expire after 60 seconds.
  Disconnect removes only that connection, preserving other tabs for the account.
- The global `PresenceController` connects only while the global player reports
  radio playback. Pause, source change, station change, and account change clean
  up the connection. Navigation alone does not interrupt listening.
- The page polls listener snapshots every five seconds. Redis failure shows
  “listeners unavailable” without blocking audio.

Presence describes cooperating playback clients, not proof that a human hears
sound. Clients can open sockets independently. It is not an analytics or billing
counter. Public avatars make active listening visible; no listening history is
written by this presence service.

## verification and rollback

Run `just backend test` for real Redis/session/WebSocket tests and the existing
station policy tests. Run frontend check, lint, and tests. On staging, verify
play/pause counts, navigation with continuing audio, font/accent settings, mobile
layout, and an empty firehose station. Authenticated avatar display also requires
a real staging login; backend tests exercise real cookie sessions and profiles.

The correction is a follow-up squash commit because #2097 already merged.
Revert the correction to restore that Svelte page; revert #2097 as well to remove
the presence endpoints and restore the original radio. No persistent data needs reversal: old leases
expire within a minute and no deployment configuration changes are required.
