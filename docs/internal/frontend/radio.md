---
title: "radio and listener presence"
---

# native radio

`/radio/[[station]]` adapts Ana’s sister-radio presentation into Svelte and uses
plyr.fm’s persistent player, cookie session, and existing appearance tokens.
The five station slugs and sampling policies stay in `api/radio/stations.py`.
No database migration, new Fly service, separate login, or radio upload path is
needed. The client requests `/radio/state?catalog_only=true` so the external
firehose broadcast is excluded. The default public state API retains its
existing live-stream behavior for older clients.

The standalone [plyr-radio fork](https://tangled.org/zzstoatzz.io/plyr-radio)
is a separate interoperability prototype. Its signed station identity and PDS
remain there; the native page does not embed that app, discover other radios,
or announce itself to a directory. Its viewer count is separate from native
playback presence. Sharing presence with the sister protocol requires an adapter;
this change does not deploy that bridge. See the
[research](../../research/2026-09-27-ana-radio-integration.md) for protocol findings.

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

Squash merge the UI, presence endpoints, and docs together. Reverting that one
commit restores the previous page. No persistent data needs reversal: old leases
expire within a minute and no deployment configuration changes are required.
