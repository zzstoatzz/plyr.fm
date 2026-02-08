"""stateless smoke tests for auth package modules."""

from backend._internal.auth.encryption import _decrypt_data, _encrypt_data
from backend._internal.auth.exchange import (
    consume_exchange_token,
    create_exchange_token,
)
from backend._internal.auth.scopes import (
    _check_scope_coverage,
    _get_missing_scopes,
    _parse_scopes,
)
from backend._internal.auth.session import Session


def test_scopes_parse_roundtrip():
    """parse and validate scope strings."""
    scope = "atproto repo:fm.plyr.track repo:fm.plyr.like"
    parsed = _parse_scopes(scope)
    assert parsed == {"repo:fm.plyr.track", "repo:fm.plyr.like"}
    assert _check_scope_coverage(scope, scope) is True
    assert _get_missing_scopes(scope, scope) == set()


def test_encryption_roundtrip():
    """encrypt/decrypt produces original."""
    original = '{"access_token": "secret123", "refresh_token": "refresh456"}'
    encrypted = _encrypt_data(original)
    assert encrypted != original
    decrypted = _decrypt_data(encrypted)
    assert decrypted == original


def test_session_dataclass_fields():
    """Session has expected fields."""
    session = Session(
        session_id="sid-123",
        did="did:plc:test",
        handle="test.bsky.social",
        oauth_session={"session_id": "oauth-123"},
    )
    assert session.session_id == "sid-123"
    assert session.did == "did:plc:test"
    assert session.handle == "test.bsky.social"
    assert session.get_oauth_session_id() == "oauth-123"


def test_session_oauth_session_id_fallback():
    """Session.get_oauth_session_id falls back to DID."""
    session = Session(
        session_id="sid-456",
        did="did:plc:fallback",
        handle="fallback.bsky.social",
        oauth_session={},
    )
    assert session.get_oauth_session_id() == "did:plc:fallback"


def test_exchange_token_functions_exist():
    """exchange token creation/consumption functions are importable."""
    assert callable(create_exchange_token)
    assert callable(consume_exchange_token)
