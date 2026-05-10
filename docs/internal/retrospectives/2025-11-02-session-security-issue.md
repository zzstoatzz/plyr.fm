## problem

**location**: src/relay/_internal/auth.py, src/relay/models/session.py, src/relay/api/auth.py

current OAuth session implementation has several security gaps:

1. **session_id exposed in URL** (line 55, api/auth.py) - vulnerable to referrer leaks, browser history
2. **no encryption at rest** - DPoP private keys, access tokens, refresh tokens stored as plaintext JSON in PostgreSQL
3. **no token rotation** - refresh tokens never rotated, violating OAuth 2.1 best practices
4. **no session expiration enforcement** - `expires_at` field exists but not validated
5. **missing cookie security attributes** - no HttpOnly, Secure, SameSite flags

## security requirements (OAuth 2.1 + ATProto)

### OWASP & RFC 9700 standards:
- never store tokens in localStorage (XSS vulnerability)
- refresh tokens must rotate on each use
- access tokens: 15-30 minutes max
- HttpOnly cookies for session IDs
- encryption at rest for sensitive data

### ATProto-specific requirements:
- DPoP keys: unique per session, never shared across devices
- access tokens: maximum 30 minutes
- refresh tokens (public clients): 2 weeks total session lifetime
- DPoP nonces: 5-minute max lifetime

## recommended implementation

### P0: immediate fixes

1. **use HTTP-only cookies instead of URL parameters**:
```python
response = RedirectResponse(url=f"{settings.frontend_url}{redirect_path}")
response.set_cookie(
    key="session_id",
    value=session_id,
    httponly=True,
    secure=True,
    samesite="lax",
    max_age=1209600  # 2 weeks
)
```

2. **implement column-level encryption using pgcrypto**:
```python
# enable extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

# encrypt before storing
encrypted_data = await db.execute(
    text("SELECT pgp_sym_encrypt(:data, :key)"),
    {"data": json.dumps(oauth_session), "key": settings.encryption_key}
)
```

3. **implement refresh token rotation**:
- on each token refresh, generate new access + refresh tokens
- invalidate old refresh token
- detect and block reuse attempts (security breach indicator)

### P1: session management

4. **enforce session expiration**:
```python
async def get_session(session_id: str) -> Session | None:
    if db_session.expires_at and datetime.now(UTC) > db_session.expires_at:
        await delete_session(session_id)
        return None
```

5. **add session timeouts to model**:
```python
class UserSession(Base):
    created_at: Mapped[datetime]
    last_activity: Mapped[datetime]  # auto-update on access
    idle_timeout_minutes: Mapped[int] = 30
    absolute_timeout_hours: Mapped[int] = 336  # 2 weeks
    expires_at: Mapped[datetime]
```

6. **automatic session cleanup** (background task):
```python
await db.execute(
    delete(UserSession).where(
        UserSession.expires_at < datetime.now(UTC)
    )
)
```

### P2: advanced security

7. **DPoP key encryption** (separate from tokens, using AES-256-GCM)
8. **audit logging** - track session creation, token refresh, security events
9. **rate limiting** - prevent brute force (slowapi: 10 login attempts/minute)
10. **session fingerprinting** - detect hijacking via IP/user-agent validation

## implementation priority matrix

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| **P0** | session_id in URL | high | low |
| **P0** | no encryption at rest | high | medium |
| **P0** | no token rotation | high | medium |
| **P1** | no expiration enforcement | medium | low |
| **P1** | missing cookie attributes | medium | low |
| **P2** | no DPoP key rotation | medium | high |
| **P2** | no audit logging | low | low |
| **P3** | no rate limiting | low | medium |

## files requiring changes

1. `src/relay/models/session.py` - add encryption, timeouts, indexes
2. `src/relay/_internal/auth.py` - implement encryption, rotation, validation
3. `src/relay/api/auth.py` - remove URL params, add secure cookies
4. `src/relay/config.py` - add encryption_key, cookie settings
5. database migration - encrypted columns, new fields

## references

- OWASP session management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OAuth 2.1 BCP (RFC 9700): https://datatracker.ietf.org/doc/rfc9700/
- ATProto OAuth spec: https://atproto.com/specs/oauth
- DPoP specification: https://datatracker.ietf.org/doc/html/rfc9449
- PostgreSQL pgcrypto: https://www.postgresql.org/docs/current/pgcrypto.html

## priority

**critical** - session_id URL exposure is immediate risk, encryption at rest required before wider deployment
