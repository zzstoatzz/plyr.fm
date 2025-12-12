"""test OAuth authentication and session management."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.auth import (
    _decrypt_data,
    _encrypt_data,
    consume_exchange_token,
    create_exchange_token,
    create_session,
    delete_session,
    get_public_jwks,
    get_session,
    is_confidential_client,
    update_session_tokens,
)
from backend.models import ExchangeToken, UserSession


def test_encryption_roundtrip():
    """verify encryption and decryption work correctly."""
    original_data = "sensitive oauth data"

    encrypted = _encrypt_data(original_data)
    decrypted = _decrypt_data(encrypted)

    assert decrypted == original_data
    assert encrypted != original_data  # ensure it's actually encrypted


def test_encryption_of_json_data():
    """verify encryption works with json-serialized data."""
    oauth_data = {
        "did": "did:plc:test123",
        "handle": "test.bsky.social",
        "access_token": "secret_token_123",
        "refresh_token": "secret_refresh_456",
        "dpop_private_key_pem": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg==\n-----END PRIVATE KEY-----",
    }

    json_str = json.dumps(oauth_data)
    encrypted = _encrypt_data(json_str)
    decrypted = _decrypt_data(encrypted)

    assert decrypted is not None
    assert json.loads(decrypted) == oauth_data


async def test_create_session_with_encryption(db_session: AsyncSession):
    """verify session creation encrypts OAuth data."""
    did = "did:plc:session123"
    handle = "session.bsky.social"
    oauth_data = {
        "did": did,
        "handle": handle,
        "access_token": "secret_token",
        "refresh_token": "secret_refresh",
        "dpop_private_key_pem": "secret_key",
    }

    session_id = await create_session(did, handle, oauth_data)

    # retrieve session and verify it was created correctly
    session = await get_session(session_id)
    assert session is not None
    assert session.did == did
    assert session.handle == handle
    assert session.oauth_session["access_token"] == "secret_token"
    assert session.oauth_session["refresh_token"] == "secret_refresh"


async def test_get_session_decrypts_data(db_session: AsyncSession):
    """verify get_session correctly decrypts OAuth data."""
    did = "did:plc:decrypt123"
    handle = "decrypt.bsky.social"
    oauth_data = {
        "did": did,
        "handle": handle,
        "access_token": "secret_token_xyz",
        "refresh_token": "secret_refresh_xyz",
    }

    session_id = await create_session(did, handle, oauth_data)

    # retrieve and verify decryption
    session = await get_session(session_id)

    assert session is not None
    assert session.did == did
    assert session.handle == handle
    assert session.oauth_session["access_token"] == "secret_token_xyz"
    assert session.oauth_session["refresh_token"] == "secret_refresh_xyz"


async def test_get_session_returns_none_for_invalid_id(db_session: AsyncSession):
    """verify get_session returns None for non-existent session."""
    session = await get_session("invalid_session_id_that_does_not_exist")
    assert session is None


async def test_update_session_tokens(db_session: AsyncSession):
    """verify session token update encrypts new data."""
    did = "did:plc:update123"
    handle = "update.bsky.social"
    original_oauth_data = {
        "access_token": "original_token",
        "refresh_token": "original_refresh",
    }

    session_id = await create_session(did, handle, original_oauth_data)

    # update with new tokens
    updated_oauth_data = {"access_token": "new_token", "refresh_token": "new_refresh"}
    await update_session_tokens(session_id, updated_oauth_data)

    # verify tokens were updated
    session = await get_session(session_id)
    assert session is not None
    assert session.oauth_session["access_token"] == "new_token"
    assert session.oauth_session["refresh_token"] == "new_refresh"


async def test_delete_session(db_session: AsyncSession):
    """verify session deletion works."""
    did = "did:plc:delete123"
    handle = "delete.bsky.social"
    oauth_data = {"access_token": "token"}

    session_id = await create_session(did, handle, oauth_data)

    # verify session exists
    session = await get_session(session_id)
    assert session is not None

    # delete session
    await delete_session(session_id)

    # verify session is gone
    session = await get_session(session_id)
    assert session is None


async def test_create_exchange_token(db_session: AsyncSession):
    """verify exchange token creation."""
    did = "did:plc:exchange123"
    handle = "exchange.bsky.social"
    oauth_data = {"access_token": "token"}

    session_id = await create_session(did, handle, oauth_data)

    # create exchange token
    token = await create_exchange_token(session_id)

    # verify token can be consumed (proves it was created correctly)
    result = await consume_exchange_token(token)
    assert result is not None
    returned_session_id, is_dev_token = result
    assert returned_session_id == session_id
    assert is_dev_token is False

    # verify token can't be reused
    second_attempt = await consume_exchange_token(token)
    assert second_attempt is None


async def test_consume_exchange_token(db_session: AsyncSession):
    """verify exchange token consumption works."""
    did = "did:plc:consume123"
    handle = "consume.bsky.social"
    oauth_data = {"access_token": "token"}

    session_id = await create_session(did, handle, oauth_data)
    token = await create_exchange_token(session_id)

    # consume token
    result = await consume_exchange_token(token)
    assert result is not None
    returned_session_id, is_dev_token = result
    assert returned_session_id == session_id
    assert is_dev_token is False

    # verify token can't be consumed again (proves it was marked as used)
    second_attempt = await consume_exchange_token(token)
    assert second_attempt is None


async def test_exchange_token_cannot_be_reused(db_session: AsyncSession):
    """verify exchange token can only be used once."""
    did = "did:plc:reuse123"
    handle = "reuse.bsky.social"
    oauth_data = {"access_token": "token"}

    session_id = await create_session(did, handle, oauth_data)
    token = await create_exchange_token(session_id)

    # consume token first time
    result = await consume_exchange_token(token)
    assert result is not None
    returned_session_id, _is_dev_token = result
    assert returned_session_id == session_id

    # try to consume again - should return None
    second_result = await consume_exchange_token(token)
    assert second_result is None


async def test_exchange_token_returns_none_for_invalid_token(db_session: AsyncSession):
    """verify consume_exchange_token returns None for invalid token."""
    result = await consume_exchange_token("invalid_token_that_does_not_exist")
    assert result is None


async def test_exchange_token_expires(db_session: AsyncSession):
    """verify expired exchange token returns None."""
    # use a separate database session to manually expire the token
    from backend.utilities.database import db_session as get_db_session

    did = "did:plc:expire123"
    handle = "expire.bsky.social"
    oauth_data = {"access_token": "token"}

    session_id = await create_session(did, handle, oauth_data)
    token = await create_exchange_token(session_id)

    # manually expire the token by updating its expiration
    async with get_db_session() as db:
        result = await db.execute(
            select(ExchangeToken).where(ExchangeToken.token == token)
        )
        exchange_token = result.scalar_one_or_none()
        assert exchange_token is not None

        # set expiration to past
        exchange_token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()

    # try to consume expired token - should return None
    consumed = await consume_exchange_token(token)
    assert consumed is None


async def test_session_isolation(db_session: AsyncSession):
    """verify each test starts with clean database."""
    # this should not see sessions from other tests
    result = await db_session.execute(select(UserSession))
    sessions = result.scalars().all()
    assert len(sessions) == 0

    result = await db_session.execute(select(ExchangeToken))
    tokens = result.scalars().all()
    assert len(tokens) == 0


async def test_create_session_with_custom_expiration(db_session: AsyncSession):
    """verify session creation with custom expiration works."""
    did = "did:plc:customexp123"
    handle = "customexp.bsky.social"
    oauth_data = {"access_token": "token", "refresh_token": "refresh"}

    # create session with 30-day expiration
    session_id = await create_session(did, handle, oauth_data, expires_in_days=30)

    # verify session exists and works
    session = await get_session(session_id)
    assert session is not None
    assert session.did == did

    # verify expiration is set (within reasonable range)
    result = await db_session.execute(
        select(UserSession).where(UserSession.session_id == session_id)
    )
    db_session_record = result.scalar_one_or_none()
    assert db_session_record is not None
    assert db_session_record.expires_at is not None

    # should expire roughly 30 days from now
    expected_expiry = datetime.now(UTC) + timedelta(days=30)
    actual_expiry = db_session_record.expires_at.replace(tzinfo=UTC)
    diff = abs((expected_expiry - actual_expiry).total_seconds())
    assert diff < 60  # within 1 minute


async def test_create_session_with_no_expiration(db_session: AsyncSession):
    """verify session creation with expires_in_days=0 creates non-expiring session."""
    did = "did:plc:noexp123"
    handle = "noexp.bsky.social"
    oauth_data = {"access_token": "token", "refresh_token": "refresh"}

    # create session with no expiration
    session_id = await create_session(did, handle, oauth_data, expires_in_days=0)

    # verify session exists
    session = await get_session(session_id)
    assert session is not None
    assert session.did == did

    # verify expires_at is None
    result = await db_session.execute(
        select(UserSession).where(UserSession.session_id == session_id)
    )
    db_session_record = result.scalar_one_or_none()
    assert db_session_record is not None
    assert db_session_record.expires_at is None


async def test_create_session_default_expiration(db_session: AsyncSession):
    """verify session creation uses default 14-day expiration."""
    did = "did:plc:defaultexp123"
    handle = "defaultexp.bsky.social"
    oauth_data = {"access_token": "token", "refresh_token": "refresh"}

    # create session with default expiration
    session_id = await create_session(did, handle, oauth_data)

    # verify expiration is set to default (14 days)
    result = await db_session.execute(
        select(UserSession).where(UserSession.session_id == session_id)
    )
    db_session_record = result.scalar_one_or_none()
    assert db_session_record is not None
    assert db_session_record.expires_at is not None

    expected_expiry = datetime.now(UTC) + timedelta(days=14)
    actual_expiry = db_session_record.expires_at.replace(tzinfo=UTC)
    diff = abs((expected_expiry - actual_expiry).total_seconds())
    assert diff < 60  # within 1 minute


# confidential client tests


def test_is_confidential_client_false_by_default():
    """verify is_confidential_client returns False when OAUTH_JWK not set."""
    # tests run without OAUTH_JWK configured
    assert is_confidential_client() is False


def test_is_confidential_client_true_when_configured():
    """verify is_confidential_client returns True when OAUTH_JWK is set."""
    test_jwk = '{"kty":"EC","crv":"P-256","x":"test","y":"test","d":"test"}'

    with patch("backend._internal.auth.settings.atproto.oauth_jwk", test_jwk):
        assert is_confidential_client() is True


def test_get_public_jwks_returns_none_without_config():
    """verify get_public_jwks returns None when OAUTH_JWK not configured."""
    # tests run without OAUTH_JWK configured
    assert get_public_jwks() is None


def test_get_public_jwks_returns_public_key():
    """verify get_public_jwks returns JWKS with public key only."""
    # generate a test JWK
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from jose import jwk as jose_jwk

    # generate test key
    private_key = ec.generate_private_key(ec.SECP256R1())
    pem_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_obj = jose_jwk.construct(pem_bytes, algorithm="ES256")
    test_jwk = json.dumps(key_obj.to_dict())

    with patch("backend._internal.auth.settings.atproto.oauth_jwk", test_jwk):
        jwks = get_public_jwks()

        assert jwks is not None
        assert "keys" in jwks
        assert len(jwks["keys"]) == 1

        public_key = jwks["keys"][0]
        # should NOT have private key component
        assert "d" not in public_key
        # should have public key components
        assert "x" in public_key
        assert "y" in public_key
        assert public_key["kty"] == "EC"
        assert public_key["alg"] == "ES256"
        assert public_key["use"] == "sig"
