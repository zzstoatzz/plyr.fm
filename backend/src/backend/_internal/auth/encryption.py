"""Fernet encryption for sensitive OAuth data at rest."""

from cryptography.fernet import Fernet

from backend.config import settings

# CRITICAL: encryption key must be configured and stable across restarts
# otherwise all sessions become undecipherable after restart
if not settings.atproto.oauth_encryption_key:
    raise RuntimeError(
        "oauth_encryption_key must be configured in settings. "
        "generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
    )

_encryption_key = settings.atproto.oauth_encryption_key.encode()
_fernet = Fernet(_encryption_key)


def _encrypt_data(data: str) -> str:
    """encrypt sensitive data for storage."""
    return _fernet.encrypt(data.encode()).decode()


def _decrypt_data(encrypted: str) -> str | None:
    """decrypt sensitive data from storage.

    returns None if decryption fails (e.g., key changed, data corrupted).
    """
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except Exception:
        # decryption failed - likely key mismatch or corrupted data
        return None
