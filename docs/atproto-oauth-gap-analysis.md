# ATProto OAuth Gap Analysis

## current state

### rust SDK (atrium_oauth)
the rust `atrium_oauth` crate provides comprehensive OAuth 2.1 support:

- **state management**: `StateStore` trait with memory and persistent implementations
- **session management**: `SessionStore` trait for managing user sessions across requests
- **DID/handle resolution**: `CommonDidResolver` and `AtprotoHandleResolver` for identity resolution
- **client metadata**: both production (`AtprotoClientMetadata`) and localhost (`AtprotoLocalhostClientMetadata`) configurations
- **DPoP support**: generates and validates DPoP (Demonstrating Proof-of-Possession) tokens
- **PKCE flow**: full support for OAuth PKCE (Proof Key for Code Exchange)
- **scope management**: built-in support for `KnownScope` enum and custom scopes
- **token refresh**: automatic refresh token handling
- **authorization flow**: complete authorize → callback → session cycle

key rust types:
```rust
pub struct OAuthClient<STATE, SESSION, DID, HANDLE> {
    config: OAuthClientConfig<STATE, SESSION, DID, HANDLE>,
    // handles all OAuth operations
}

pub trait StateStore {
    async fn get(&self, key: &str) -> Result<State>;
    async fn set(&self, key: &str, state: State) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<()>;
}

pub trait SessionStore {
    async fn get(&self, key: &str) -> Result<Session>;
    async fn set(&self, key: &str, session: Session) -> Result<()>;
    async fn delete(&self, key: &str) -> Result<()>;
}
```

### python SDK (atproto)
the python `atproto` package provides:

- **basic client**: `Client` and `AsyncClient` for making authenticated requests
- **session handling**: `Session` dataclass for storing auth state
- **identity resolution**: basic DID/handle resolution via `IdResolver`
- **JWT utilities**: `parse_jwt`, `verify_jwt`, functions for token validation

**what's missing:**
- no OAuth client implementation
- no state/session store abstractions
- no authorization URL generation
- no callback handling
- no DPoP token generation
- no PKCE implementation
- no client metadata management
- no refresh token flow

## what we need for relay MVP

for the relay artist portal, we need:

1. **authorization flow**:
   - user enters bluesky handle
   - redirect to OAuth provider with scopes:
     - `Scope::Known(KnownScope::Atproto)` - basic atproto access
     - `Scope::Unknown("repo:app.relay.track")` - permission to create track records
   - callback receives authorization code
   - exchange code for access/refresh tokens

2. **session management**:
   - store OAuth session keyed by user DID
   - associate tracks with artist DID
   - handle token refresh

3. **record creation**:
   - use OAuth session to create `app.relay.track` records in artist's repo
   - include audio metadata, file references

## implementation options

### option 1: manual OAuth implementation (current approach)
implement OAuth flow directly using `httpx` and ATProto spec:

pros:
- full control over implementation
- can tailor to our specific needs
- learn OAuth/ATProto deeply

cons:
- more code to maintain
- need to handle edge cases ourselves
- potential security issues if not careful

### option 2: contribute OAuth to python atproto SDK
port rust `atrium_oauth` patterns to python:

pros:
- benefits entire ecosystem
- battle-tested patterns from rust implementation
- community review and maintenance

cons:
- larger scope, takes more time
- need to coordinate with SDK maintainers
- requires understanding both rust and python implementations

## upstream contribution guide

if someone wanted to add OAuth support to the python atproto SDK, here's a rough plan:

### 1. understand the rust implementation

study these files in [MarshalX/atproto-oauth](https://github.com/MarshalX/atproto/tree/main/packages/oauth):
- `src/lib.rs` - main OAuth client
- `src/client/config.rs` - client configuration
- `src/dpop.rs` - DPoP token generation
- `src/stores/` - state and session stores
- `src/resolver.rs` - DID/handle resolution

### 2. design python API

create pythonic equivalent of rust types:

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

@dataclass
class OAuthState:
    """OAuth state parameter for CSRF protection."""
    state: str
    code_verifier: str  # for PKCE
    redirect_uri: str
    created_at: datetime

@dataclass
class OAuthSession:
    """OAuth session with tokens."""
    did: str
    access_token: str
    refresh_token: Optional[str]
    expires_at: datetime
    dpop_key: str  # for DPoP

class StateStore(ABC):
    """Abstract store for OAuth state."""

    @abstractmethod
    async def get(self, key: str) -> Optional[OAuthState]:
        pass

    @abstractmethod
    async def set(self, key: str, state: OAuthState) -> None:
        pass

    @abstractmethod
    async def delete(self, key: str) -> None:
        pass

class SessionStore(ABC):
    """Abstract store for OAuth sessions."""

    @abstractmethod
    async def get(self, key: str) -> Optional[OAuthSession]:
        pass

    @abstractmethod
    async def set(self, key: str, session: OAuthSession) -> None:
        pass

    @abstractmethod
    async def delete(self, key: str) -> None:
        pass

class OAuthClient:
    """ATProto OAuth 2.1 client."""

    def __init__(
        self,
        client_id: str,
        redirect_uri: str,
        state_store: StateStore,
        session_store: SessionStore,
        scopes: list[str],
    ):
        self.client_id = client_id
        self.redirect_uri = redirect_uri
        self.state_store = state_store
        self.session_store = session_store
        self.scopes = scopes

    async def authorize(self, handle: str) -> str:
        """Generate authorization URL for handle."""
        # 1. resolve handle to DID
        # 2. discover authorization server
        # 3. generate PKCE challenge
        # 4. generate state parameter
        # 5. store state in state_store
        # 6. build authorization URL with scopes
        pass

    async def callback(
        self,
        code: str,
        state: str,
        iss: Optional[str] = None,
    ) -> OAuthSession:
        """Handle OAuth callback and exchange code for tokens."""
        # 1. verify state parameter
        # 2. retrieve code_verifier from state_store
        # 3. generate DPoP key pair
        # 4. exchange authorization code for tokens
        # 5. create and store session
        # 6. return session
        pass

    async def refresh(self, session: OAuthSession) -> OAuthSession:
        """Refresh expired session tokens."""
        # 1. generate DPoP proof for refresh
        # 2. call token endpoint with refresh_token
        # 3. update session with new tokens
        # 4. save updated session
        pass
```

### 3. implement DPoP support

DPoP (Demonstrating Proof-of-Possession) is required by ATProto OAuth:

```python
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
import jwt

class DPoPKeyPair:
    """EC key pair for DPoP."""

    def __init__(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.public_key = self.private_key.public_key()

    def generate_proof(
        self,
        htm: str,  # HTTP method
        htu: str,  # HTTP URI
        ath: Optional[str] = None,  # access token hash
    ) -> str:
        """Generate DPoP proof JWT."""
        # create JWT with DPoP claims
        # sign with private key
        # return proof token
        pass
```

### 4. implement store backends

provide common implementations:

```python
class MemoryStateStore(StateStore):
    """In-memory state store (development only)."""

    def __init__(self):
        self._states: dict[str, OAuthState] = {}

class SQLiteSessionStore(SessionStore):
    """SQLite-backed session store."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        # initialize db schema
```

### 5. integration with existing client

modify `atproto.Client` to accept OAuth sessions:

```python
class Client:
    """ATProto client with OAuth support."""

    def __init__(self, base_url: str = None):
        self._session: Optional[Union[Session, OAuthSession]] = None

    async def login_oauth(self, oauth_session: OAuthSession):
        """Authenticate using OAuth session."""
        self._session = oauth_session
        # configure client to use OAuth tokens with DPoP
```

### 6. testing strategy

- unit tests for each component
- integration tests with test OAuth server
- reference rust implementation for behavior
- test against real ATProto PDS

### 7. documentation

- comprehensive docstrings
- usage examples
- migration guide from app passwords
- security best practices

### 8. submit PR

- follow python SDK contribution guidelines
- link to rust implementation for reference
- provide working examples
- discuss in ATProto community Discord

## estimated effort

- **research & design**: 1-2 weeks
- **core implementation**: 2-3 weeks
- **testing & polish**: 1-2 weeks
- **documentation**: 1 week
- **PR review & iterations**: 1-2 weeks

**total**: ~2-3 months for complete, production-ready implementation

## immediate relay workaround

for relay MVP, we can:

1. manually implement minimal OAuth flow
2. use httpx to call OAuth endpoints directly
3. store sessions in SQLite
4. use atproto.Client once we have tokens

this gets us working now while proper OAuth support is developed upstream.
