# next/web

layout and design follow bluesky's social-app (see [DESIGN.md](DESIGN.md) for the tokens, the shell and the prod → next parity inventory).

the frontend for next.plyr.fm, built for a **read-only appview**:

- the browser signs in with atproto oauth (`@atcute/oauth-browser-client`) and
  holds the session. the zig api never sees it.
- writes (likes now; playlists, profile, uploads next) go straight to the
  user's PDS as the real `fm.plyr.*` records.
- reads come only from the zig appview's `/v1`. after a write, the client calls
  `GET /v1/records/await?uri=&cid=` to wait until the relay ingester has
  projected it.

```sh
cp .env.example .env   # PUBLIC_API_URL, PUBLIC_SITE_URL, PUBLIC_NSID_PREFIX
npm install
npm run dev            # http://127.0.0.1:5174 (atproto oauth loopback client)
```

deploys to the production branch of the cloudflare pages project `plyr-fm-next` (served at next.plyr.fm) via
`.github/workflows/deploy-web-next.yml`. it never touches `frontend/`,
`production-fe` or the prod pages project.

### Private preferences

Next requests a grant for the user's own `self` preferences Space on PDSes
that advertise Spaces. The [declaration](lexicons/preferences.json) and
[record schema](lexicons/preference.json) use the staging namespace. Publish
both under `com.atproto.lexicon.schema` before enabling
`PUBLIC_PREFERENCE_SYNC=true`. The reference OAuth server resolves the
declaration for consent even when the scope explicitly lists its collection.
Existing sessions get the grant on sign-in. Sign-in can fall back to a
device-only session if the PDS rejects the Space scope.

The browser creates a personalspace on the first edit and verifies the policy
before each sync. It reads and writes through the account's PDS with OAuth.
Unsent edits are cached by DID and retried on focus, reconnect, or request.
Volume is device-local. The record uses integer percentages for text scale.
The alpha putRecord has no compare-and-swap field. Each write merges the
latest record before putting it, but truly simultaneous writes can still
race across devices.

For Jams, test a memberspace with independent participants on different
PDSes. Membership controls access and each participant writes into their own
space repo. Probe authoritative host state, participant command ordering and
recovery from the space sequence before choosing the playback transport.
The Jams browser acceptance scenarios are tracked in [#2303](https://github.com/zzstoatzz/plyr.fm/issues/2303).
