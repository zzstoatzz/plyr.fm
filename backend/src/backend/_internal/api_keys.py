"""API key generation and validation."""

import secrets

import argon2

from backend.models.api_key import KeyEnvironment, KeyType

# argon2 hasher for key storage
_hasher = argon2.PasswordHasher(
    time_cost=2,
    memory_cost=65536,
    parallelism=1,
)


def generate_api_key(
    key_type: KeyType = KeyType.SECRET,
    environment: KeyEnvironment = KeyEnvironment.LIVE,
) -> tuple[str, str, str]:
    """
    Generate a new API key.

    Returns:
        (full_key, prefix, hash)

    The full_key is shown once to the user, then discarded.
    Only prefix and hash are stored.
    """
    # generate 32 random bytes (256 bits of entropy)
    random_part = secrets.token_urlsafe(32)

    # construct full key
    env_str = "live" if environment == KeyEnvironment.LIVE else "test"
    type_str = "sk" if key_type == KeyType.SECRET else "pk"
    full_key = f"plyr_{type_str}_{env_str}_{random_part}"

    # prefix for lookup (enough to be unique, short enough to display)
    prefix = full_key[:24]

    # hash for verification
    key_hash = _hasher.hash(full_key)

    return full_key, prefix, key_hash


def verify_api_key(full_key: str, stored_hash: str) -> bool:
    """Verify an API key against its stored hash."""
    try:
        _hasher.verify(stored_hash, full_key)
        return True
    except (
        argon2.exceptions.VerifyMismatchError,
        argon2.exceptions.VerificationError,
        argon2.exceptions.InvalidHashError,
    ):
        return False


def parse_api_key(full_key: str) -> tuple[KeyType, KeyEnvironment] | None:
    """
    Parse key type and environment from key format.

    Returns None if key format is invalid.
    """
    if not full_key.startswith("plyr_"):
        return None

    parts = full_key.split("_")
    if len(parts) < 4:
        return None

    type_str, env_str = parts[1], parts[2]

    if type_str == "sk":
        key_type = KeyType.SECRET
    elif type_str == "pk":
        key_type = KeyType.PUBLISHABLE
    else:
        return None

    if env_str == "live":
        environment = KeyEnvironment.LIVE
    elif env_str == "test":
        environment = KeyEnvironment.TEST
    else:
        return None

    return key_type, environment
