"""v1 API - API key management endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.api_keys import generate_api_key
from backend._internal.auth import Session, require_auth
from backend.models import APIKey, KeyEnvironment, KeyType, get_db

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


class CreateKeyRequest(BaseModel):
    """request to create a new API key."""

    name: str
    key_type: str = "secret"
    environment: str = "live"
    expires_in_days: int | None = None


class CreateKeyResponse(BaseModel):
    """response after creating an API key - includes full key (shown once)."""

    id: str
    key: str  # full key, shown ONLY once
    name: str
    key_type: str
    environment: str
    key_prefix: str
    created_at: str
    expires_at: str | None = None


class KeyInfo(BaseModel):
    """API key info (without the actual key)."""

    id: str
    name: str
    key_type: str
    environment: str
    key_prefix: str
    created_at: str
    expires_at: str | None = None
    last_used_at: str | None = None
    is_active: bool


@router.post("/", response_model=CreateKeyResponse)
async def create_api_key(
    request: CreateKeyRequest,
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CreateKeyResponse:
    """create a new API key.

    the full key is returned ONLY in this response - store it securely.
    it cannot be retrieved later.
    """
    # validate key_type and environment
    try:
        key_type = KeyType(request.key_type)
    except ValueError:
        raise HTTPException(400, f"invalid key_type: {request.key_type}") from None

    try:
        environment = KeyEnvironment(request.environment)
    except ValueError:
        raise HTTPException(
            400, f"invalid environment: {request.environment}"
        ) from None

    # generate key
    full_key, prefix, key_hash = generate_api_key(key_type, environment)

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
        key_type=key_type.value,
        environment=environment.value,
        expires_at=expires_at,
    )

    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return CreateKeyResponse(
        id=str(api_key.id),
        key=full_key,  # shown only once!
        name=api_key.name,
        key_type=api_key.key_type,
        environment=api_key.environment,
        key_prefix=api_key.key_prefix,
        created_at=api_key.created_at.isoformat(),
        expires_at=api_key.expires_at.isoformat() if api_key.expires_at else None,
    )


@router.get("/", response_model=list[KeyInfo])
async def list_api_keys(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[KeyInfo]:
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
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """revoke an API key. cannot be undone."""
    try:
        key_uuid = UUID(key_id)
    except ValueError:
        raise HTTPException(400, "invalid key id") from None

    # atomic update to prevent race conditions
    result = await db.execute(
        update(APIKey)
        .where(APIKey.id == key_uuid)
        .where(APIKey.owner_did == session.did)
        .where(APIKey.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
        .returning(APIKey.id)
    )
    await db.commit()

    if result.scalar_one_or_none() is None:
        # either key doesn't exist, not owned by user, or already revoked
        raise HTTPException(404, "key not found or already revoked")

    return {"revoked": True}
