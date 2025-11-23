"""TID (Timestamp Identifier) generation for ATProto records.

TIDs are base32-sortable identifiers that encode a 64-bit timestamp.

Spec: https://atproto.com/specs/tid

Format:
- 1 bit: always 0 (top bit)
- 53 bits: microseconds since UNIX epoch
- 10 bits: clock identifier (for collision avoidance)
Total: 64 bits, encoded as 13 base32 characters
"""

from datetime import UTC, datetime

# base32-sortable alphabet (from spec)
_TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz"


def datetime_to_tid(dt: datetime, clock_id: int = 0) -> str:
    """Generate a TID from a datetime, preserving the original timestamp.

    This allows recreating ATProto records with their original creation time,
    maintaining chronological order in collections.

    args:
        dt: datetime to convert (must be timezone-aware)
        clock_id: 10-bit clock identifier (0-1023) for collision avoidance.
                 defaults to 0 for recreation of historical records.

    returns:
        13-character base32-encoded TID string

    raises:
        ValueError: if datetime is not timezone-aware or clock_id out of range
    """
    if dt.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")

    if not 0 <= clock_id < 1024:  # 2^10 = 1024
        raise ValueError(f"clock_id must be 0-1023, got {clock_id}")

    # convert to UTC
    dt_utc = dt.astimezone(UTC)

    # get microseconds since unix epoch
    # spec: "next 53 bits: microseconds since UNIX epoch"
    timestamp_us = int(dt_utc.timestamp() * 1_000_000)

    # ensure timestamp fits in 53 bits (top bit must be 0)
    if timestamp_us >= (1 << 53):
        raise ValueError(f"timestamp {timestamp_us} exceeds 53-bit limit")

    # construct 64-bit integer:
    # - top bit: 0 (implicit, timestamp_us < 2^53)
    # - next 53 bits: timestamp_us
    # - final 10 bits: clock_id
    tid_int = (timestamp_us << 10) | clock_id

    # encode as base32-sortable (13 characters for 64 bits)
    # 64 bits / 5 bits per char = 12.8, rounds to 13 chars
    chars = []
    for _ in range(13):
        chars.append(_TID_ALPHABET[tid_int & 0x1F])  # 0x1F = 0b11111 (5 bits)
        tid_int >>= 5

    return "".join(reversed(chars))


def tid_to_datetime(tid: str) -> datetime:
    """Decode a TID back to its timestamp.

    args:
        tid: 13-character base32-encoded TID string

    returns:
        datetime in UTC

    raises:
        ValueError: if TID is invalid format
    """
    if len(tid) != 13:
        raise ValueError(f"TID must be exactly 13 characters, got {len(tid)}")

    # decode from base32-sortable
    tid_int = 0
    for char in tid:
        if char not in _TID_ALPHABET:
            raise ValueError(f"invalid character in TID: {char}")
        tid_int = (tid_int << 5) | _TID_ALPHABET.index(char)

    # ensure top bit is 0 (per spec)
    if tid_int & (1 << 63):
        raise ValueError("invalid TID: top bit must be 0")

    # extract timestamp (top 53 bits after the leading 0)
    timestamp_us = tid_int >> 10

    # convert to datetime
    return datetime.fromtimestamp(timestamp_us / 1_000_000, tz=UTC)
