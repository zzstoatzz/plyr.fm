# API key database schema

detailed schema design for API key management.

## tables

### api_keys

stores API key metadata. the actual key is never stored - only a hash.

```sql
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ownership
    owner_did VARCHAR NOT NULL REFERENCES artists(did) ON DELETE CASCADE,

    -- key identification
    key_prefix VARCHAR(20) NOT NULL,      -- "plyr_sk_live_abc1" (first ~20 chars for lookup)
    key_hash VARCHAR(128) NOT NULL,       -- argon2id hash of full key

    -- metadata
    name VARCHAR(100) NOT NULL,           -- user-provided name, e.g. "production server"
    key_type VARCHAR(10) NOT NULL,        -- "secret" or "publishable"
    environment VARCHAR(10) NOT NULL,     -- "live" or "test"

    -- access control (future)
    scopes JSONB DEFAULT '[]'::jsonb,     -- ["items:read", "items:write", ...]
    allowed_ips JSONB DEFAULT NULL,       -- ["192.168.1.0/24", ...] or null for any

    -- lifecycle
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,               -- null = no expiration
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,               -- null = active, set = revoked

    -- audit
    created_from_ip INET,
    last_used_from_ip INET,

    CONSTRAINT key_type_check CHECK (key_type IN ('secret', 'publishable')),
    CONSTRAINT environment_check CHECK (environment IN ('live', 'test'))
);

-- indexes
CREATE INDEX idx_api_keys_owner ON api_keys(owner_did);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_active ON api_keys(owner_did) WHERE revoked_at IS NULL;
```

### api_key_usage (optional, for analytics)

tracks API usage per key for rate limiting and analytics.

```sql
CREATE TABLE api_key_usage (
    id BIGSERIAL PRIMARY KEY,
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,

    -- request info
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code SMALLINT NOT NULL,

    -- timing
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    response_time_ms INTEGER,

    -- context
    ip_address INET,
    user_agent VARCHAR(500)
);

-- partition by month for efficient cleanup
-- indexes for rate limiting queries
CREATE INDEX idx_api_key_usage_key_time ON api_key_usage(api_key_id, timestamp DESC);
CREATE INDEX idx_api_key_usage_recent ON api_key_usage(timestamp DESC) WHERE timestamp > now() - interval '1 hour';
```

## SQLAlchemy model

```python
# backend/src/backend/models/api_key.py
"""API key model for developer access."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base


class KeyType(StrEnum):
    SECRET = "secret"
    PUBLISHABLE = "publishable"


class KeyEnvironment(StrEnum):
    LIVE = "live"
    TEST = "test"


class APIKey(Base):
    """API key for developer access."""

    __tablename__ = "api_keys"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )

    # ownership
    owner_did: Mapped[str] = mapped_column(
        String, ForeignKey("artists.did", ondelete="CASCADE"), nullable=False, index=True
    )

    # key identification
    key_prefix: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    # metadata
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_type: Mapped[KeyType] = mapped_column(String(10), nullable=False)
    environment: Mapped[KeyEnvironment] = mapped_column(String(10), nullable=False)

    # access control
    scopes: Mapped[list] = mapped_column(JSONB, default=list)
    allowed_ips: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # lifecycle
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # audit
    created_from_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    last_used_from_ip: Mapped[str | None] = mapped_column(INET, nullable=True)

    # relationships
    owner = relationship("Artist", back_populates="api_keys")

    __table_args__ = (
        Index("idx_api_keys_active", "owner_did", postgresql_where="revoked_at IS NULL"),
    )

    @property
    def is_active(self) -> bool:
        """check if key is active (not revoked or expired)."""
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None and self.expires_at < datetime.now(UTC):
            return False
        return True

    @property
    def display_key(self) -> str:
        """return masked key for display: plyr_sk_live_abc1...xyz9"""
        return f"{self.key_prefix}...{self.key_prefix[-4:]}"
```

## key generation

```python
# backend/src/backend/_internal/api_keys.py
"""API key generation and validation."""

import hashlib
import secrets
from datetime import UTC, datetime

import argon2

from backend.models.api_key import APIKey, KeyEnvironment, KeyType

# argon2 hasher for key storage
_hasher = argon2.PasswordHasher(
    time_cost=2,
    memory_cost=65536,
    parallelism=1,
)


def generate_api_key(
    key_type: KeyType,
    environment: KeyEnvironment,
) -> tuple[str, str, str]:
    """
    generate a new API key.

    returns:
        (full_key, prefix, hash)

    the full_key is shown once to the user, then discarded.
    only prefix and hash are stored.
    """
    # generate 32 random bytes (256 bits of entropy)
    random_part = secrets.token_urlsafe(32)

    # construct full key
    env_str = "live" if environment == KeyEnvironment.LIVE else "test"
    type_str = "sk" if key_type == KeyType.SECRET else "pk"
    full_key = f"plyr_{type_str}_{env_str}_{random_part}"

    # prefix for lookup (enough to be unique, short enough to display)
    prefix = full_key[:20]

    # hash for verification
    key_hash = _hasher.hash(full_key)

    return full_key, prefix, key_hash


def verify_api_key(full_key: str, stored_hash: str) -> bool:
    """verify an API key against its stored hash."""
    try:
        _hasher.verify(stored_hash, full_key)
        return True
    except argon2.exceptions.VerifyMismatchError:
        return False


def parse_api_key(full_key: str) -> tuple[KeyType, KeyEnvironment] | None:
    """
    parse key type and environment from key format.

    returns None if key format is invalid.
    """
    if not full_key.startswith("plyr_"):
        return None

    parts = full_key.split("_")
    if len(parts) < 4:
        return None

    type_str, env_str = parts[1], parts[2]

    try:
        key_type = KeyType.SECRET if type_str == "sk" else KeyType.PUBLISHABLE
        environment = KeyEnvironment.LIVE if env_str == "live" else KeyEnvironment.TEST
        return key_type, environment
    except ValueError:
        return None
```

## authentication middleware

```python
# backend/src/backend/_internal/auth.py (additions)

async def authenticate_api_key(
    authorization: str | None,
    db: AsyncSession,
) -> APIKey | None:
    """
    authenticate request via API key.

    returns APIKey if valid, None otherwise.
    updates last_used_at on successful auth.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None

    full_key = authorization.removeprefix("Bearer ").strip()

    # quick format check
    if not full_key.startswith("plyr_"):
        return None

    # extract prefix for lookup
    prefix = full_key[:20]

    # find key by prefix
    result = await db.execute(
        select(APIKey)
        .where(APIKey.key_prefix == prefix)
        .where(APIKey.revoked_at.is_(None))
    )
    api_key = result.scalar_one_or_none()

    if not api_key:
        return None

    # verify hash
    if not verify_api_key(full_key, api_key.key_hash):
        return None

    # check expiration
    if not api_key.is_active:
        return None

    # update last used (fire and forget)
    api_key.last_used_at = datetime.now(UTC)
    await db.commit()

    return api_key
```

## portal endpoints

```python
# backend/src/backend/api/api_keys.py
"""API key management endpoints for the portal."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


class CreateKeyRequest(BaseModel):
    name: str
    key_type: KeyType = KeyType.SECRET
    environment: KeyEnvironment = KeyEnvironment.LIVE
    expires_in_days: int | None = None


class CreateKeyResponse(BaseModel):
    """response includes the full key - shown only once."""
    id: str
    key: str  # full key, shown once
    name: str
    key_type: str
    environment: str
    created_at: str


class KeyInfo(BaseModel):
    """key info without the actual key."""
    id: str
    name: str
    key_type: str
    environment: str
    key_prefix: str  # "plyr_sk_live_abc1..."
    created_at: str
    expires_at: str | None
    last_used_at: str | None
    is_active: bool


@router.post("/", response_model=CreateKeyResponse)
async def create_api_key(
    request: CreateKeyRequest,
    session: Session = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """create a new API key. the full key is returned only once."""
    # generate key
    full_key, prefix, key_hash = generate_api_key(
        request.key_type, request.environment
    )

    # calculate expiration
    expires_at = None
    if request.expires_in_days:
        expires_at = datetime.now(UTC) + timedelta(days=request.expires_in_days)

    # create record
    api_key = APIKey(
        owner_did=session.did,
        key_prefix=prefix,
        key_hash=key_hash,
        name=request.name,
        key_type=request.key_type,
        environment=request.environment,
        expires_at=expires_at,
    )

    db.add(api_key)
    await db.commit()

    return CreateKeyResponse(
        id=str(api_key.id),
        key=full_key,  # shown only once!
        name=api_key.name,
        key_type=api_key.key_type,
        environment=api_key.environment,
        created_at=api_key.created_at.isoformat(),
    )


@router.get("/", response_model=list[KeyInfo])
async def list_api_keys(
    session: Session = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """list all API keys for the authenticated user."""
    result = await db.execute(
        select(APIKey)
        .where(APIKey.owner_did == session.did)
        .order_by(APIKey.created_at.desc())
    )
    keys = result.scalars().all()

    return [
        KeyInfo(
            id=str(key.id),
            name=key.name,
            key_type=key.key_type,
            environment=key.environment,
            key_prefix=key.key_prefix,
            created_at=key.created_at.isoformat(),
            expires_at=key.expires_at.isoformat() if key.expires_at else None,
            last_used_at=key.last_used_at.isoformat() if key.last_used_at else None,
            is_active=key.is_active,
        )
        for key in keys
    ]


@router.delete("/{key_id}")
async def revoke_api_key(
    key_id: str,
    session: Session = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """revoke an API key. cannot be undone."""
    result = await db.execute(
        select(APIKey)
        .where(APIKey.id == key_id)
        .where(APIKey.owner_did == session.did)
    )
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(404, "key not found")

    if api_key.revoked_at:
        raise HTTPException(400, "key already revoked")

    api_key.revoked_at = datetime.now(UTC)
    await db.commit()

    return {"revoked": True}
```

## migration

```python
# alembic/versions/xxx_add_api_keys.py
"""add api_keys table.

Revision ID: xxx
Revises: previous
Create Date: 2025-xx-xx
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'xxx'
down_revision = 'previous'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'api_keys',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('owner_did', sa.String(), sa.ForeignKey('artists.did', ondelete='CASCADE'), nullable=False),
        sa.Column('key_prefix', sa.String(20), nullable=False),
        sa.Column('key_hash', sa.String(128), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('key_type', sa.String(10), nullable=False),
        sa.Column('environment', sa.String(10), nullable=False),
        sa.Column('scopes', postgresql.JSONB(), server_default='[]'),
        sa.Column('allowed_ips', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_from_ip', postgresql.INET(), nullable=True),
        sa.Column('last_used_from_ip', postgresql.INET(), nullable=True),
    )

    op.create_index('idx_api_keys_owner', 'api_keys', ['owner_did'])
    op.create_index('idx_api_keys_prefix', 'api_keys', ['key_prefix'])
    op.create_index(
        'idx_api_keys_active',
        'api_keys',
        ['owner_did'],
        postgresql_where=sa.text('revoked_at IS NULL')
    )


def downgrade() -> None:
    op.drop_table('api_keys')
```

## security considerations

1. **key storage**: only store argon2id hash, never the raw key
2. **key display**: show full key exactly once at creation, then only prefix
3. **rate limiting**: apply stricter limits to invalid key attempts
4. **audit trail**: log all key creations and revocations
5. **IP allowlisting**: optional but recommended for production keys
6. **expiration**: encourage expiring keys, auto-cleanup after 30 days revoked
