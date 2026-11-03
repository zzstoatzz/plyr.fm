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
