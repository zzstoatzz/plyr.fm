---
title: "authentication"
description: "OAuth flow, developer tokens, and scoped requests"
---

plyr.fm uses ATProto OAuth 2.1 for authentication. there are two ways to authenticate API requests: browser sessions (for web apps) and developer tokens (for scripts, bots, and integrations).

## developer tokens

the simplest way to authenticate. generate a token at [plyr.fm/portal](https://plyr.fm/portal) and pass it as a Bearer token:

```bash
curl -H "Authorization: Bearer your_token" https://api.plyr.fm/tracks/liked
```

```python
from plyrfm import PlyrClient

client = PlyrClient(token="your_token")
my_tracks = client.my_tracks()
```

tokens are scoped to your account and have independent OAuth credentials — refreshing your browser session won't invalidate them. revoke tokens at any time from the portal.

### creating tokens

1. go to [plyr.fm/portal](https://plyr.fm/portal)
2. click "developer tokens"
3. name your token and choose an expiry (default: 180 days)
4. you'll be redirected through an OAuth flow to authorize the token
5. copy the token — it won't be shown again

### token lifetime

tokens default to 180-day sessions. the underlying OAuth access token refreshes automatically when it expires. if the refresh fails (e.g. the PDS revokes the grant), the token becomes invalid.

## OAuth flow (for apps)

if you're building a web app or client that authenticates plyr.fm users, you'll use the standard ATProto OAuth 2.1 flow:

### 1. start authorization

```
POST /auth/start?handle=user.bsky.social
```

returns a redirect to the user's PDS authorization page. the PDS shows the user what permissions your app is requesting.

### 2. handle callback

```
GET /auth/callback?code=...&state=...&iss=...
```

the PDS redirects back with an authorization code. plyr.fm exchanges this for tokens and returns an `exchange_token`.

### 3. exchange for session

```
POST /auth/exchange
Body: { "exchange_token": "..." }
```

returns a `session_id`. for browser apps, this is set as an HttpOnly cookie. for SDKs, use it as a Bearer token.

### session details

- **storage**: HttpOnly cookies (browser) or Authorization header (API)
- **lifetime**: 14 days (auto-refreshes on activity)
- **cookie name**: `session_id`
- **cookie flags**: HttpOnly, Secure (HTTPS only), SameSite=Lax

### client metadata

plyr.fm's OAuth client metadata is at:

```
GET /meta/oauth-client-metadata.json
```

this tells PDS servers what plyr.fm is allowed to request.

## scopes

plyr.fm requests the following OAuth scopes:

| scope | purpose |
|-------|---------|
| `repo:fm.plyr.track` | create, update, delete tracks |
| `repo:fm.plyr.like` | like and unlike tracks |
| `repo:fm.plyr.comment` | timed comments |
| `repo:fm.plyr.list` | playlists, albums, liked lists |
| `repo:fm.plyr.actor.profile` | artist profile |
| `repo:fm.teal.alpha.feed.play` | scrobbles to [teal.fm](https://teal.fm) |
| `blob:*/*` | upload audio and images |

if your session is missing a required scope (e.g. new features were added since you authenticated), the API returns `403` with `"detail": "scope_upgrade_required"`. re-authenticate via `/auth/scope-upgrade/start` to grant the new scopes.

## multi-account support

plyr.fm supports linking multiple ATProto accounts:

```
POST /auth/add-account/start
Body: { "handle": "other-account.bsky.social" }
```

switch between linked accounts:

```
POST /auth/switch-account
Body: { "target_did": "did:plc:..." }
```

## important notes

- **never store session IDs in localStorage** — they belong in HttpOnly cookies for browser apps, or securely stored tokens for server-side apps
- sessions are validated on every request for expiration and scope coverage
- rate limits on auth endpoints are stricter (~10 req/min)
- developer tokens get their own OAuth credentials to avoid staleness when browser sessions refresh
