"""feature flag utilities.

per-user feature flags stored in a dedicated table.
flags are enabled by admins via script and checked in backend code.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.feature_flag import FeatureFlag

# known flags - add new flags here for documentation
KNOWN_FLAGS = frozenset(
    {
        "lossless-uploads",  # enable AIFF/FLAC upload support
    }
)


async def has_flag(db: AsyncSession, user_did: str, flag: str) -> bool:
    """check if a user has a feature flag enabled.

    args:
        db: database session
        user_did: the user's DID
        flag: the flag name (kebab-case, e.g. "lossless-uploads")

    returns:
        True if the flag is enabled for this user
    """
    result = await db.execute(
        select(FeatureFlag).where(
            FeatureFlag.user_did == user_did,
            FeatureFlag.flag == flag,
        )
    )
    return result.scalar_one_or_none() is not None


async def get_user_flags(db: AsyncSession, user_did: str) -> list[str]:
    """get all enabled flags for a user.

    args:
        db: database session
        user_did: the user's DID

    returns:
        list of enabled flag names
    """
    result = await db.execute(
        select(FeatureFlag.flag).where(FeatureFlag.user_did == user_did)
    )
    return list(result.scalars().all())


async def enable_flag(db: AsyncSession, user_did: str, flag: str) -> bool:
    """enable a feature flag for a user.

    args:
        db: database session
        user_did: the user's DID
        flag: the flag name

    returns:
        True if flag was newly enabled, False if already enabled
    """
    # check if already enabled
    existing = await db.execute(
        select(FeatureFlag).where(
            FeatureFlag.user_did == user_did,
            FeatureFlag.flag == flag,
        )
    )
    if existing.scalar_one_or_none():
        return False

    # create new flag
    db.add(FeatureFlag(user_did=user_did, flag=flag))
    await db.flush()
    return True


async def disable_flag(db: AsyncSession, user_did: str, flag: str) -> bool:
    """disable a feature flag for a user.

    args:
        db: database session
        user_did: the user's DID
        flag: the flag name

    returns:
        True if flag was disabled, False if wasn't enabled
    """
    result = await db.execute(
        select(FeatureFlag).where(
            FeatureFlag.user_did == user_did,
            FeatureFlag.flag == flag,
        )
    )
    flag_record = result.scalar_one_or_none()
    if not flag_record:
        return False

    await db.delete(flag_record)
    await db.flush()
    return True
