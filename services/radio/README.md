# Sister-radio syndication

This service runs our [fork of Ana’s sister-radio](https://tangled.org/zzstoatzz.io/plyr-radio)
as a catalog-only protocol adapter. The native UI remains at `https://plyr.fm/radio`.
The Dockerfile pins the fork revision; updates require a reviewed PR here.

One `plyr-radio` Fly Machine in Chicago serves all four identities:

| Station | Host / did:web suffix |
| --- | --- |
| loved | `radio.plyr.fm` |
| fresh | `fresh.radio.plyr.fm` |
| deep-cuts | `deep-cuts.radio.plyr.fm` |
| slop | `slop.radio.plyr.fm` |

Each exposes its own signed `pet.nkp.radio.station/self`, DID document, read-only
repository, and playback/WebSocket endpoints. Startup announces each host to
`relay.fire.hose.cam` and `syndication.sharkgirl.pet`. Firehose remains available
in the native tuner but its empty catalog archive is not advertised externally.
Browser visits to the adapter redirect to the corresponding native radio page.
The native tuner continues to show only plyr stations.

## Ownership and restrictions

The adapter reads production `/radio/state?station=…&catalog_only=true`; it does
not select tracks or maintain a competing queue. Audio requests validate catalog
membership and redirect to the existing plyr audio endpoint/CDN. Byte ranges and
cross-origin playback remain supported without proxying audio through the adapter.
Artwork is still proxied. All non-read HTTP methods are blocked, including uploads,
URL imports, queue/control mutations, and chat writes. CLI imports are disabled.

Remote viewer hello/keepalive messages maintain anonymous native presence sockets.
Native cookie-authenticated listeners supply the public avatars. The adapter
ignores remote client-supplied DIDs; it does not share or mint login sessions.
Presence snapshots are cached per station for five seconds. Clients that only
fetch audio do not register presence, and listener counts are not analytics.

The 1GB `radio_data` volume holds the persistent signing key in SQLite. Preserve
it across deployments and migration; deleting it changes the station public key.
No production database credentials are supplied to this service. The app has one
512MB shared-CPU Machine and no redundancy. App-scoped `FLY_API_TOKEN_RADIO` lives
in GitHub Actions secrets. Shared IPv4/IPv6 and DNS-only CNAMEs route the four hosts
to `plyr-radio.fly.dev`; Fly terminates TLS for each hostname.

## Deploy and verify

Merge the Dockerfile revision/configuration PR, then explicitly deploy:

```sh
just --justfile services/radio/justfile deploy
just --justfile services/radio/justfile status
```

The workflow builds and runs the fork's Rust tests before deploying. It is manual;
merging this service configuration alone does not promote it. Do not run local
`fly deploy`. This service release does not require a plyr backend/frontend release.

From a checkout of the pinned fork, run `node scripts/smoke-syndication.mjs` with
Node 22+. It checks actual directory discovery, all four signed repository exports,
current catalog tracks and clock positions, CDN byte ranges, rejected writes,
and native WebSocket presence with an untrusted DID. It briefly registers one
anonymous listener. Also verify playback in Ana’s deployed player:
`https://radio.wisp.place/embed?station=https%3A%2F%2Fradio.plyr.fm`.

If a startup announcement failed while TLS/routing was becoming ready, inspect
Fly logs and retry each host with `POST` to the directory's
`/xrpc/com.atproto.sync.requestCrawl`, JSON `{"hostname":"radio.plyr.fm"}` (and the
other three hosts). Directory inclusion alone is insufficient: test playback too.

## Rollback and consolidation

Revert the pinned revision/configuration through a PR and rerun the workflow.
To withdraw the service, stop its Machine and let the directory's health checks
remove it. Preserve the volume and identities. Native radio remains independent
of this adapter and keeps playing if the adapter is down.

[Issue #2102](https://github.com/zzstoatzz/plyr.fm/issues/2102) tracks moving the
protocol surface into plyr's backend and retiring this separate runtime.
