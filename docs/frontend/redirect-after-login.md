---
title: "redirect after login"
---

# redirect after login

## the problem

unauthenticated users who follow a deep link (e.g. a jam invite `/jam/abc123`) get redirected to the login page. after completing the OAuth flow, they land on `/portal` with no memory of where they were trying to go. the invite link is lost.

## the solution

a short-lived cookie (`plyr_return_to`) stores the intended destination before redirecting to login. after the OAuth exchange completes, the portal (or profile setup page) reads the cookie, clears it, and redirects the user to the original URL.

## flow

```
1. user visits /jam/abc123 (unauthenticated)
2. jam page renders preview UI with "sign in" button
3. user clicks sign in → handleSignIn() calls setReturnUrl('/jam/abc123')
4. user proceeds through OAuth login at their PDS
5. PDS redirects back → /portal?exchange_token=…
6. portal exchanges token, sets session cookie
7. portal reads plyr_return_to cookie → '/jam/abc123'
8. portal clears the cookie and redirects to /jam/abc123
9. jam page runs onMount, sees auth, joins the jam
```

if the user is new and goes through profile setup (`/profile/setup`), the redirect happens after profile creation instead of at the portal step — same cookie, same logic.

## implementation

### `frontend/src/lib/utils/return-url.ts`

three functions manage the cookie:

```typescript
setReturnUrl(path: string): void   // write cookie (validates path first)
getReturnUrl(): string | null       // read cookie value
clearReturnUrl(): void              // delete cookie (max-age=0)
```

### cookie parameters

| parameter  | value       | rationale |
|------------|-------------|-----------|
| name       | `plyr_return_to` | distinct from session cookie |
| path       | `/`         | accessible from any route (portal, profile/setup) |
| max-age    | `600` (10 min) | short TTL — stale return URLs are worse than no redirect |
| SameSite   | `Lax`       | survives the OAuth redirect chain (top-level navigations) |
| HttpOnly   | no          | intentional — client-side JS needs to read it; value is a URL path, not a secret |
| Secure     | not set     | works on localhost; cookie contains no sensitive data |

### open redirect prevention

`setReturnUrl` rejects any path that does not start with `/` or starts with `//`:

```typescript
if (!path.startsWith('/') || path.startsWith('//')) return;
```

this prevents an attacker from crafting a link like `/jam/x` that somehow sets the return URL to `//evil.com` or `https://evil.com`. only same-origin relative paths are accepted.

## integration points

### jam page (`frontend/src/routes/jam/[code]/+page.svelte`)

the "sign in" button handler calls `setReturnUrl` with the current jam path before the user navigates to login:

```typescript
function handleSignIn() {
    setReturnUrl(`/jam/${data.code}`);
}
```

### portal (`frontend/src/routes/portal/+page.svelte`)

after a successful token exchange, checks for a return URL and redirects if one exists:

```typescript
await auth.refresh();
await preferences.fetch();
const r = getReturnUrl();
if (r) { clearReturnUrl(); window.location.href = r; return; }
```

### profile setup (`frontend/src/routes/profile/setup/+page.svelte`)

new users who complete profile creation also check the cookie:

```typescript
if (response.ok) {
    const returnTo = getReturnUrl();
    if (returnTo) {
        clearReturnUrl();
        window.location.href = returnTo;
        return;
    }
    window.location.href = '/portal';
}
```

both consumers use `window.location.href` (full navigation) rather than SvelteKit's `goto()` to ensure a clean page load at the destination.

## extending to other pages

to preserve any pre-login destination, call `setReturnUrl` before the user leaves for login:

```typescript
import { setReturnUrl } from '$lib/utils/return-url';

// in your "sign in" handler:
setReturnUrl(window.location.pathname + window.location.search);
```

the portal and profile/setup pages already handle the read side — no changes needed there. the cookie expires after 10 minutes, so stale redirects are not a concern.
