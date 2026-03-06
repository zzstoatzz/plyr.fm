---
title: "redirect after login (deep link preservation through auth)"
---

# redirect after login (deep link preservation through auth)

**status:** research complete
**date:** 2026-02-28

## problem

when an unauthenticated user follows a deep link (e.g. a jam invite, a shared track, a profile page), they need to log in before they can interact. after login, they should land on the page they originally intended to visit — not a generic dashboard.

this is the "redirect after login" or "return URL" pattern. getting it wrong means:
- users lose context and have to re-find the link
- invite/share flows feel broken
- new user onboarding from shared content is frustrating

for plyr.fm specifically: someone shares a jam link, the recipient clicks it, sees "log in to join this jam," authenticates via ATProto OAuth (which bounces through a third-party PDS), and should land directly in the jam — not on `/`.

## how popular products handle this

### GitHub

GitHub uses a `return_to` query parameter. when you visit a protected page unauthenticated (e.g. a private repo settings page), the login page URL becomes `/login?return_to=%2Fsettings%2F...`. after successful auth, GitHub redirects to the stored `return_to` value. the parameter is URL-encoded and validated server-side. GitHub also preserves `return_to` through their OAuth flow by encoding context in the OAuth `state` parameter.

### Discord

Discord handles invite links (`discord.gg/xxxxx`) by showing the server preview (name, member count, description) even to unauthenticated users. if the user clicks "Accept Invite," they're prompted to log in or create an account. Discord preserves the invite context through the auth flow — after login/signup, the user is automatically joined to the server. the invite metadata is stored server-side (keyed by invite code), so there's no URL parameter to lose. for users who already have the app installed, invite links trigger a deep link to the native app.

### Slack

Slack invite links show workspace information without requiring auth. clicking "Join" prompts email verification (magic link flow). the invite context is preserved via the invite token in the URL, which maps to server-side state. after creating an account or logging in, the user is added to the workspace. notably, Slack uses email verification rather than OAuth redirect, which avoids the multi-step redirect problem entirely.

### Google Docs / Drive

Google shows a "you need access" interstitial when an unauthenticated user visits a restricted document. after login, the user lands on the document if they have permission, or sees a "request access" page if they don't. Google preserves the document URL through their auth flow using the `continue` parameter. for public documents ("anyone with link"), no auth is needed at all.

### Figma

Figma's sharing behavior depends on plan tier and share settings. "anyone with link" on professional plans doesn't require login. on starter plans, viewers must be invited and logged in. Figma redirects to `/email_only` for auth, preserving the file URL. this is a common source of user complaints — the behavior is described as "unintuitive and needlessly complicated" because users can't always tell when login will be required.

### Notion

Notion distinguishes between "publish to web" (truly public, no login) and "share with link" (requires Notion account). published pages get a different URL format. shared pages require login and preserve the page URL through the auth flow via query parameter.

### Linear

Linear uses OAuth 2.0 with a `state` parameter that preserves context through redirects. invite links redirect to login with the team/workspace context preserved. if the user has previously approved access, Linear auto-redirects without showing the consent screen again.

### Spotify

Spotify share links (open.spotify.com) work without auth for basic content display. interacting (play, save, follow) triggers auth. the target content is encoded in the URL structure itself (`/track/xxx`, `/playlist/xxx`), so no separate return URL is needed — after auth, the user is on the same page. there are known issues with Safari on iOS where the post-auth redirect fails and users get stuck on the auth page.

## technical approaches

### approach 1: query parameter (most common)

store the return URL as a query parameter on the login page URL.

| framework | parameter name | example |
|-----------|---------------|---------|
| Django | `next` | `/login?next=/dashboard/lesson/42` |
| Rails (Devise) | `redirect_to` | `/users/sign_in?redirect_to=/settings` |
| Next.js (NextAuth) | `callbackUrl` | `/api/auth/signin?callbackUrl=/protected` |
| GitHub | `return_to` | `/login?return_to=%2Frepo%2Fsettings` |
| Auth0 | `redirect` | configurable in rules |
| Discourse | `return_path` | `/login?return_path=/topic/123` |

**naming conventions seen in the wild:**
- `next` — Django, many Python frameworks
- `return_to` — GitHub, Ruby ecosystems
- `redirect_to` — Rails, general web
- `redirect` — generic
- `callbackUrl` — NextAuth.js, Next.js ecosystem
- `continue` — Google
- `redirect_uri` — OAuth 2.0 (different purpose: callback URL, not return URL)

**pros:** simple, stateless, works across browser restarts
**cons:** URL can get very long, exposed in browser history and referrer headers, must be validated to prevent open redirect

### approach 2: cookie/session storage

store the return URL in a session cookie before redirecting to login.

```
1. user visits /jam/abc123
2. server sets cookie: plyr_return_to=/jam/abc123
3. server redirects to /login
4. user authenticates
5. server reads cookie, redirects to /jam/abc123
6. server clears cookie
```

**pros:** return URL not visible in browser bar, no length limits, survives page reloads
**cons:** cookies can expire or be cleared, doesn't survive cross-device flows, adds server-side state

### approach 3: OAuth `state` parameter

encode the return URL (or a reference to it) in the OAuth `state` parameter. the `state` value survives the entire OAuth redirect chain and is returned to the callback URL.

```
1. user visits /jam/abc123 (unauthenticated)
2. app stores return_to=/jam/abc123 in session
3. app generates state=<random> and maps state -> session
4. user is redirected to PDS authorization server with state=<random>
5. user authenticates at PDS
6. PDS redirects to app callback with state=<random>&code=xxx
7. app looks up session from state, finds return_to=/jam/abc123
8. app completes token exchange, redirects to /jam/abc123
```

**pros:** works with multi-step OAuth, survives third-party redirects, CSRF protection built in
**cons:** more complex to implement, state must be stored server-side (or encrypted/signed if embedded)

### approach 4: localStorage (avoid for auth-critical flows)

store the return URL in `localStorage` before redirecting to login.

**pros:** simple to implement, persists across tabs
**cons:** XSS-vulnerable, not accessible server-side, breaks HttpOnly security model, cleared by "clear site data"

### recommended approach for plyr.fm

**combine query parameter + cookie + OAuth state** — this is the belt-and-suspenders approach that handles ATProto's multi-step OAuth flow:

1. when an unauthenticated user visits a protected page, redirect to `/login?return_to=/jam/abc123`
2. the login page stores `return_to` in an HttpOnly cookie (short-lived, 10 minutes)
3. when OAuth starts, the `return_to` value is associated with the OAuth session (via the `state` parameter mapping)
4. after OAuth completes and the callback fires, read the `return_to` from the session/cookie
5. redirect to `return_to` (with validation) or fall back to `/`
6. clear the cookie

the query parameter provides visibility ("you can see where you'll go after login"), the cookie provides persistence (survives the OAuth bounce through the PDS), and the state mapping provides security (ties the return URL to the specific auth session).

## security considerations

### open redirect vulnerability

the biggest risk with redirect-after-login is **open redirect**: an attacker crafts a URL like `/login?return_to=https://evil.com/phishing` and the app blindly redirects there after login, lending credibility to the phishing site because the user just authenticated on the real site.

### validation strategies (from OWASP)

**1. allow relative paths only (recommended for most apps)**

```python
from urllib.parse import urlparse

def validate_return_url(url: str) -> str | None:
    """return the URL if it's a safe relative path, None otherwise."""
    if not url:
        return None
    # must start with / but not //
    if not url.startswith("/") or url.startswith("//"):
        return None
    # parse and verify no scheme or netloc
    parsed = urlparse(url)
    if parsed.scheme or parsed.netloc:
        return None
    return url
```

**2. allowlist of paths or prefixes**

```python
ALLOWED_PREFIXES = ["/jam/", "/track/", "/profile/", "/settings"]

def validate_return_url(url: str) -> str | None:
    url = validate_relative_url(url)
    if url and any(url.startswith(p) for p in ALLOWED_PREFIXES):
        return url
    return None
```

**3. never do this — common bypass techniques:**

| bypass | why it works |
|--------|-------------|
| `//evil.com` | protocol-relative URL, browser navigates to `evil.com` |
| `/\evil.com` | some parsers treat `\` as `/`, creating `//evil.com` |
| `javascript:alert(1)` | scheme injection |
| `https://trusted.com@evil.com` | userinfo abuse — browser goes to `evil.com` |
| `data:text/html,...` | data URI scheme |
| URL-encoded variants | `%2F%2Fevil.com` bypasses string checks but is decoded by browser |

**4. never use blocklists** — there are always new bypass techniques. always use allowlists (permit known-good patterns, reject everything else).

**5. server-side token mapping (most secure)**

instead of passing the URL as a parameter, map it to a short-lived token:

```python
# when creating the redirect
token = secrets.token_urlsafe(16)
await cache.set(f"return_to:{token}", "/jam/abc123", ttl=600)
# redirect to /login?return_token=xyz

# after login
url = await cache.get(f"return_to:{token}")
await cache.delete(f"return_to:{token}")
# redirect to url or /
```

this eliminates open redirect entirely — the URL never appears in the query string.

## edge cases and gotchas

### long redirect URLs

URLs with query parameters and fragments can exceed browser/server limits. browser limits vary (IE had 2083 chars, modern browsers support much more) but intermediate proxies, CDNs, and OAuth providers may truncate. Microsoft's identity platform limits redirect URIs to 256 characters.

**mitigations:**
- store the full URL server-side and pass only a token/key in the query parameter
- strip unnecessary query parameters before storing
- set a maximum length and fall back to `/` if exceeded

### user creates a new account instead of logging in

the return URL must survive the login-vs-signup decision. if the login page offers both options:

- if `return_to` is a query parameter, it must be passed to the signup form/page too
- if stored in a cookie, it naturally survives the switch between login and signup
- if stored in OAuth state, it survives regardless of whether the user logs in or creates a new account at the PDS

**key insight:** most OAuth providers (including ATProto PDS) handle both login and registration on their end, so the return URL only needs to survive on the client app side, not at the auth provider.

### multi-step OAuth (ATProto-specific)

ATProto OAuth is particularly challenging because:

1. the user enters their handle on the app
2. the app resolves the handle to a DID, then to a PDS, then to an authorization server
3. this resolution involves 5+ API calls
4. the user is redirected to the authorization server (which may be a different domain than the PDS)
5. the user authenticates there
6. the authorization server redirects back to the app's callback URL with a `code` and `state`
7. the app exchanges the code for tokens

the return URL must survive this entire chain. the `state` parameter is the only reliable mechanism — it's passed to the authorization server and returned unchanged. store the return URL in server-side session keyed by the `state` value.

```
user clicks /jam/abc123
  → app stores {state: "xyz", return_to: "/jam/abc123"} in session/redis
  → app redirects to PDS auth server with state=xyz
  → user authenticates at PDS
  → PDS redirects to /auth/callback?code=abc&state=xyz
  → app looks up state=xyz → return_to="/jam/abc123"
  → app redirects to /jam/abc123
```

### redirect target requires permissions the user doesn't have

after login, the user might not have the right to access the target resource. distinguish between:

| scenario | response |
|----------|----------|
| unauthenticated | redirect to login with return URL |
| authenticated, has access | show the page |
| authenticated, no access | show 403 page with context ("this jam is private" / "request access") |
| authenticated, resource doesn't exist | show 404 |

never redirect back to login if the user is already authenticated but lacks permissions — this creates an infinite redirect loop. Django had [a bug like this](https://code.djangoproject.com/ticket/28379).

### OAuth callback URL fragment loss

URL fragments (the `#` part) are not sent to servers by browsers. if the original URL was `/jam/abc123#chat`, the `#chat` part is lost when the server stores the return URL. this is usually acceptable — fragments are for client-side state and the page can reconstruct them.

### race conditions with multiple tabs

if a user opens two protected links in different tabs, each tab might try to set the same cookie or session key with different return URLs. the last one wins. this is generally acceptable — the user will land on one of the two pages and can navigate to the other.

### expired or consumed return URLs

return URL tokens/cookies should be short-lived (10 minutes max) and single-use. after redirect, delete the stored value. this prevents replay and stale redirects.

## UX best practices

### 1. tell the user why they need to log in

bad: generic "please log in" page
good: contextual message based on what they were trying to do

| context | message |
|---------|---------|
| jam invite | "log in to join this jam" |
| shared track | "log in to listen to this track" |
| profile page | "log in to follow @artist" |
| settings | "log in to access your settings" |
| generic | "log in to continue" |

the login page should receive enough context to display this. either:
- pass a `context` parameter alongside `return_to` (e.g. `?return_to=/jam/abc&context=jam_invite`)
- derive the context from the return URL path (if `/jam/` then it's a jam invite)

### 2. show a preview of what's behind the login

Discord does this well — you see the server name, icon, member count, and description before being asked to log in. this motivates the user to complete the auth flow.

for plyr.fm jams: show the jam name, host, current listeners, and maybe the currently playing track — all public information that doesn't require auth.

### 3. make login-vs-signup frictionless

the user arriving via a shared link might not have an account. the auth flow should handle both cases without losing the return URL:
- single "continue with ATProto" button that handles both login and registration at the PDS
- no separate signup page that loses the return URL context

### 4. handle the "already logged in" case

if a logged-in user clicks a jam invite link, skip the login step entirely and go straight to joining the jam. don't show a login page to an already-authenticated user.

### 5. provide feedback after redirect

after the user logs in and lands on the target page, provide confirmation that they arrived where they intended:
- for jams: "you've joined the jam!" toast
- for tracks: start playing immediately
- for follows: "you're now following @artist"

### 6. graceful degradation

if the return URL is lost (cookie expired, state mismatch, validation failure), redirect to `/` with a subtle message: "welcome back!" rather than showing an error. the user can still navigate to what they wanted manually.

## the invite/shared link variant

shared links that require auth are a special case because they often involve an **action** (join, follow, add to library) not just **viewing** a page.

### pattern: action-on-arrival

```
1. user clicks shared link: /jam/abc123/join
2. app sees /join suffix → this is an action, not a view
3. app redirects to login with return_to=/jam/abc123/join
4. user authenticates
5. app redirects to /jam/abc123/join
6. page handler: user is now authenticated, execute join action
7. redirect to /jam/abc123 (the view) with success toast
```

the `/join` endpoint is both the redirect target AND the action handler. if the user is authenticated, it performs the action. if not, it triggers the login flow.

### pattern: token-based invites (like Discord)

```
1. host creates jam invite → generates invite code: plyr.fm/invite/XyZ123
2. recipient clicks link
3. app looks up invite code → finds jam metadata
4. app shows preview: "join [jam name] hosted by @artist"
5. if unauthenticated: "log in to join" → auth flow preserving invite code
6. if authenticated: "join" button → POST /api/jam/join with invite code
7. after joining: redirect to /jam/abc123
```

the invite code is the state, not the URL. the code maps to server-side data (which jam, who created it, expiration, max uses). this is more robust than preserving a URL because:
- the invite can expire
- the invite can be single-use or limited-use
- the invite can carry permissions (e.g. "join as co-host")
- the invite URL is short and shareable

### comparison of shared link approaches

| approach | example | pros | cons |
|----------|---------|------|------|
| **direct URL** | `/jam/abc123` | simple, bookmarkable | no expiration, no usage limits |
| **URL + action suffix** | `/jam/abc123/join` | clear intent, works as redirect target | slightly more routing complexity |
| **invite code** | `/invite/XyZ123` | expirable, usage limits, metadata | requires server-side invite storage |
| **signed URL** | `/jam/abc123?token=hmac...` | no server storage, tamper-proof | long URLs, can't revoke |

for plyr.fm jams, the **invite code** approach is likely best — it already aligns with the existing jam sharing model and supports features like expiration and usage limits.

## implementation sketch for plyr.fm

### backend

```python
# in hooks or middleware: detect unauthenticated access to protected routes
async def require_auth(request: Request) -> Response | None:
    if not request.state.user:
        return_to = request.url.path
        if request.url.query:
            return_to += f"?{request.url.query}"
        # validate return_to
        if not is_safe_return_url(return_to):
            return_to = "/"
        # store in session for OAuth flow
        request.session["return_to"] = return_to
        return RedirectResponse(f"/login?return_to={quote(return_to)}")
    return None

# after OAuth callback completes
async def handle_oauth_callback(request: Request):
    # ... token exchange ...
    return_to = request.session.pop("return_to", "/")
    if not is_safe_return_url(return_to):
        return_to = "/"
    return RedirectResponse(return_to)
```

### frontend (SvelteKit)

```typescript
// hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  const session = await getSession(event);

  if (isProtectedRoute(event.url.pathname) && !session) {
    const returnTo = event.url.pathname + event.url.search;
    // store in cookie for OAuth flow persistence
    event.cookies.set('plyr_return_to', returnTo, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600 // 10 minutes
    });
    throw redirect(303, `/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  return resolve(event);
};
```

### login page

```svelte
<!-- contextual messaging based on return_to -->
{#if returnTo?.startsWith('/jam/')}
  <p>log in to join this jam</p>
{:else if returnTo?.startsWith('/track/')}
  <p>log in to listen</p>
{:else}
  <p>log in to continue</p>
{/if}
```

## references

- [OWASP Unvalidated Redirects and Forwards Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) — canonical security guidance
- [Auth0: Redirect Users After Login](https://auth0.com/docs/authenticate/login/redirect-users-after-login) — state parameter and cookie approaches
- [Auth0: State Parameters for Attack Prevention](https://auth0.com/docs/secure/attack-protection/state-parameters) — security properties of the state parameter
- [ATProto OAuth spec](https://atproto.com/specs/oauth) — multi-step OAuth flow for AT Protocol
- [Bluesky OAuth Client Implementation Guide](https://docs.bsky.app/docs/advanced-guides/oauth-client) — practical ATProto OAuth implementation
- [PortSwigger: URL Validation Bypass Cheat Sheet](https://portswigger.net/web-security/ssrf/url-validation-bypass-cheat-sheet) — comprehensive list of URL validation bypasses
- [Next.js: Preserving Deep Links After Login](https://dev.to/dalenguyen/fixing-nextjs-authentication-redirects-preserving-deep-links-after-login-pkk) — practical implementation walkthrough
- [Django Login Redirect Pattern](https://django.wiki/snippets/authentication-authorization/redirect-after-login/) — canonical `?next=` implementation
- [SvelteKit Hooks Documentation](https://svelte.dev/docs/kit/hooks) — handle hook for route protection
- [Figma Sharing & Permissions](https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions) — example of complex share link behavior
- [Slack: Join a Workspace](https://slack.com/help/articles/212675257-Join-a-Slack-workspace) — invite link flow documentation
- [Authgear: Login & Signup UX 2025 Guide](https://www.authgear.com/post/login-signup-ux-guide) — modern auth UX patterns
