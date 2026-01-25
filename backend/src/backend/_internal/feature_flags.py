"""feature flag utilities.

simple per-user feature flags stored as a list on the Artist model.
flags are enabled by admins via script and checked in backend code.
"""

from typing import Any

# known flags - add new flags here for documentation
KNOWN_FLAGS = frozenset(
    {
        "lossless-uploads",  # enable AIFF/FLAC upload support
    }
)


def has_flag(artist: Any, flag: str) -> bool:
    """check if an artist has a feature flag enabled.

    args:
        artist: object with enabled_flags attribute (typically Artist model)
        flag: the flag name (kebab-case, e.g. "lossless-uploads")

    returns:
        True if the flag is enabled for this artist
    """
    return flag in (artist.enabled_flags or [])
