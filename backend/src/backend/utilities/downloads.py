"""helpers for user-facing file downloads."""

from urllib.parse import quote

# characters that break filesystems or the quoted-string header grammar
_UNSAFE = set('\\/:*?"<>|')


def download_filename(artist: str, title: str, extension: str) -> str:
    """build `artist - title.ext`, safe for filesystems."""
    stem = f"{artist} - {title}" if artist else title
    cleaned = "".join(c for c in stem if c not in _UNSAFE and c.isprintable())
    cleaned = " ".join(cleaned.split()).strip(". ") or "track"
    return f"{cleaned}.{extension}"


def content_disposition(filename: str) -> str:
    """RFC 6266 attachment disposition with a unicode-capable filename*.

    the plain `filename` parameter is ascii-only for old clients; `filename*`
    carries the real name percent-encoded as UTF-8 and wins where supported.
    """
    ascii_name = filename.encode("ascii", "replace").decode("ascii")
    utf8_name = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}"
