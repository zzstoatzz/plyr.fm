# multi-account experience

**status:** design draft
**issue:** [#583](https://github.com/zzstoatzz/plyr.fm/issues/583)
**date:** 2026-01-03

## problem

users with multiple ATProto identities (personal account, artist alias, band account) cannot easily switch between them. the current flow:

1. click logout
2. session destroyed, cookie cleared
3. navigate to login
4. enter new handle
5. redirected to PDS - but PDS auto-approves if "remember this account" was checked
6. no way to force account selection or fresh login

the PDS remembers the client and auto-signs in, making multi-account workflows frustrating.

## ATProto OAuth prompt parameter

the AT Protocol OAuth spec supports a `prompt` parameter with three modes:

| value | behavior |
|-------|----------|
| `login` | forces re-authentication, ignoring remembered session |
| `select_account` | shows account selection instead of auto-selecting |
| `consent` | forces consent screen even if previously approved |

**prerequisite:** our atproto SDK fork needs to accept `prompt` in `start_authorization()`.

**status:** PR opened ([zzstoatzz/atproto#8](https://github.com/zzstoatzz/atproto/pull/8))

```python
# new signature
async def start_authorization(
    self,
    handle_or_did: str,
    prompt: Literal["login", "select_account", "consent", "none"] | None = None
) -> tuple[str, str]
```

## design options

### option A: session stack (recommended)

store multiple sessions server-side, switch by rotating which one is "active."

**how it works:**

1. user logs in with account A - session created, cookie set
2. user clicks "add account" - redirected with `prompt=login`
3. user logs in with account B - second session created
4. both sessions stored in database, linked by a "session group" or stored as array in encrypted cookie
5. user menu shows both accounts, click to switch active

**session storage approaches:**

| approach | pros | cons |
|----------|------|------|
| **encrypted cookie array** | no db schema change, stateless switching | cookie size limits (~4KB), complex encryption |
| **session groups table** | clean relational model, unlimited accounts | db schema migration, additional queries |
| **localStorage + session_id** | simple to implement | XSS-vulnerable, breaks HttpOnly security model |

**recommendation:** session groups table - maintains security model, clean data relationships.

**schema sketch:**

```sql
-- new table: links multiple sessions as a group
CREATE TABLE session_groups (
    group_id UUID PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW()
);

-- modify user_sessions to reference group
ALTER TABLE user_sessions ADD COLUMN group_id UUID REFERENCES session_groups(group_id);
ALTER TABLE user_sessions ADD COLUMN is_active BOOLEAN DEFAULT true;

-- index for fast group lookups
CREATE INDEX idx_sessions_group ON user_sessions(group_id);
```

**backend changes:**

- `POST /auth/add-account` - starts OAuth with `prompt=login`, links to existing session group
- `POST /auth/switch-account` - sets `is_active=false` on current, `is_active=true` on target
- `GET /auth/me` - returns active session info + list of other accounts in group
- cookie still holds single `session_id` - backend looks up group from it

**frontend changes:**

- user menu shows current account + "add account" option
- if multiple accounts in group, show account switcher
- clicking different account calls `/auth/switch-account`

### option B: browser-managed (simpler, less ideal)

don't store multiple sessions - just make switching easier.

**how it works:**

1. "switch account" button triggers OAuth with `prompt=select_account`
2. current session destroyed before redirect
3. PDS shows account picker
4. user picks account, new session created

**pros:** minimal backend changes, no schema migration
**cons:** loses previous session entirely, can't "quick switch" back

### option C: parallel windows (no code changes)

educate users to use private/incognito windows for different accounts.

**pros:** zero implementation effort
**cons:** poor UX, not a real solution

## UX flows

### when logged in (single account)

```
┌─────────────────────────────┐
│  @artist.bsky.social   ▼    │
├─────────────────────────────┤
│  ⬚ portal                   │
│  ⚙ settings                 │
│  ─────────────────────────  │
│  + add account              │  ← new
│  ─────────────────────────  │
│  ⎋ logout                   │
└─────────────────────────────┘
```

### when logged in (multiple accounts)

```
┌─────────────────────────────┐
│  @artist.bsky.social   ▼    │  ← active account
├─────────────────────────────┤
│  ⬚ portal                   │
│  ⚙ settings                 │
│  ─────────────────────────  │
│  ○ @personal.bsky.social    │  ← switch to this
│  ○ @band.music              │  ← switch to this
│  + add account              │
│  ─────────────────────────  │
│  ⎋ logout                   │  ← logs out active only
│  ⎋ logout all               │  ← clears entire group
└─────────────────────────────┘
```

### logout behavior

**question:** what should "logout" do with multiple accounts?

| option | behavior |
|--------|----------|
| **logout active only** | removes current session, auto-switches to next account in group |
| **logout all** | destroys entire session group, back to login page |

**recommendation:** default to logout active, provide "logout all" as separate option.

### edge cases

1. **session expires for one account** - remove from group, notify if it was active
2. **scope upgrade needed** - only affects the active session, not others in group
3. **cross-tab sync** - BroadcastChannel already exists; extend to broadcast account switches
4. **queue state** - queue is global, not per-account (music keeps playing during switch)
5. **mobile (ProfileMenu)** - same UX, adapted for touch

## implementation phases

### phase 1: prompt parameter support

1. fork update: add `prompt` param to `start_authorization()`
2. backend: pass prompt to SDK in `/auth/start`
3. frontend: "sign in with different account" uses `prompt=login`

**outcome:** users can force re-auth, but still single-session.

### phase 2: session groups

1. database migration for session groups
2. `/auth/add-account` endpoint
3. `/auth/switch-account` endpoint
4. modify `/auth/me` to return account list
5. frontend account switcher UI

**outcome:** full multi-account experience.

### phase 3: polish

1. account avatars in switcher
2. keyboard shortcut for quick-switch (Cmd+Shift+A?)
3. "switch to" option in artist page when viewing own other account
4. notification badge per account (future)

## security considerations

- **no localStorage for session IDs** - maintains HttpOnly security model
- **session group isolation** - groups are per-browser, not per-user (different devices = different groups)
- **cookie still single value** - one active session_id, backend resolves group membership
- **logout clears cookie regardless** - even with session groups, logout destroys the cookie

## open questions

1. **should we limit accounts per group?** (suggest: 5 max)
2. **what about developer tokens?** - probably exclude from session groups, they're standalone
3. **how to handle account picker on login page?** - show known accounts if cookie exists but session expired?
4. **mobile app (future)** - will need equivalent session group storage in secure keychain

## bluesky implementation study

studied bluesky's open-source client ([social-app](https://github.com/bluesky-social/social-app)) to inform our design.

### their architecture

**session state shape:**
```typescript
interface SessionState {
  accounts: SessionAccount[]      // all accounts, even expired ones
  currentAccount: SessionAccount  // active account reference
  hasSession: boolean
}
```

**per-account data:**
- `did`: primary identifier
- `accessJwt` / `refreshJwt`: tokens (may be empty if expired)
- `handle`, `email`, display metadata
- accounts persist even after logout (tokens cleared, account stays in list)

**key files:**
- `src/state/session/reducer.ts` - state transitions
- `src/components/dialogs/SwitchAccount.tsx` - switcher UI
- `src/lib/hooks/useAccountSwitcher.ts` - switching logic
- `src/components/AccountList.tsx` - account list rendering

### their UX patterns

1. **account list items:**
   - 48x48 avatar
   - display name + @handle
   - green checkmark (not chevron) on current account
   - "logged out" italic label for expired sessions

2. **switching flow:**
   - if tokens valid: `resumeSession()` silently
   - if tokens expired: show login form for that specific account
   - race condition protection via `pendingDid` state

3. **logout distinction:**
   - `logoutCurrentAccount`: clears tokens, account stays in list
   - `logoutEveryAccount`: clears everything, back to login

4. **cross-tab sync:**
   - `synced-accounts` action handles changes from other tabs
   - `needsPersist` flag prevents sync cycles

### what we can adopt

| pattern | bluesky | plyr.fm adaptation |
|---------|---------|-------------------|
| account list with avatars | 48x48 + name + handle | same, with our design tokens |
| checkmark on active | green circle-check | use `var(--success)` |
| expired session label | "logged out" italic | same |
| logout vs logout-all | two distinct actions | same approach |
| token-based resume | client-side jwt check | server-side via session group |
| cross-tab sync | BroadcastChannel | extend existing player sync |

### key difference

bluesky stores tokens client-side (react native app). we store sessions server-side (HttpOnly cookies). our session group approach achieves the same UX with better web security.

## references

- [ATProto OAuth spec](https://github.com/bluesky-social/atproto/blob/main/packages/oauth/oauth-provider/src/oauth-provider.ts) - prompt parameter handling
- [bluesky social-app](https://github.com/bluesky-social/social-app) - multi-account reference implementation
- [issue #583](https://github.com/zzstoatzz/plyr.fm/issues/583) - original feature request
- [PRs #578, #582](https://github.com/zzstoatzz/plyr.fm/pull/578) - confidential OAuth client context
- [atproto SDK fork PR #8](https://github.com/zzstoatzz/atproto/pull/8) - prompt parameter support
