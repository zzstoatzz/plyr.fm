"""helpers for user-facing file downloads."""

import re
from collections.abc import Iterable, Mapping
from typing import Any, Literal, TypeAlias

from backend._internal.content_labels import has_copyright_label
from backend.storage.keys import AudioKey, InvalidMediaExtension

DownloadRefusal: TypeAlias = Literal["private", "gated", "copyright", "artist_opt_out"]

# a file_id minted by our upload path: sha256 truncated to 16 hex chars.
# anything else (e.g. a record rkey) came from the firehose and names nothing
# in our bucket — see _internal/CLAUDE.md and #1811.
_UPLOAD_FILE_ID = re.compile(r"[0-9a-f]{16}")


def download_key(
    *,
    file_id: str,
    file_type: str | None,
    original_file_id: str | None,
    original_file_type: str | None,
    r2_url: str | None,
    audio_storage: str,
) -> AudioKey | None:
    """the public-bucket key a download would serve, or None if we hold none.

    None for PDS-only rows (the R2 copy is gone or never existed — a PDS
    getBlob URL can't carry a filename disposition) and for firehose-ingested
    rows that were never mirrored (their `file_id` is an author-supplied rkey
    and their `r2_url` names someone else's origin). presigning without this
    check "succeeds" and hands the listener a NoSuchKey error body.
    """
    if audio_storage == "pds":
        return None
    try:
        if original_file_id and original_file_type:
            return AudioKey.for_file(original_file_id, original_file_type)
        if r2_url and (from_url := AudioKey.from_url(r2_url)):
            return from_url
        if file_type and _UPLOAD_FILE_ID.fullmatch(file_id):
            return AudioKey.for_file(file_id, file_type)
    except InvalidMediaExtension:
        return None
    return None


def download_refusal(
    *,
    is_private: bool,
    support_gate: Mapping[str, Any] | None,
    labels: Iterable[str],
    moderation_override: str | None,
    allow_downloads: bool | None,
) -> DownloadRefusal | None:
    """single source of the download policy; None means downloadable.

    both the download endpoint and TrackResponse.downloadable derive from this,
    so the UI never offers what the endpoint would refuse. keyed on the
    copyright *label* — the decided moderation state that discovery, radio,
    and streaming already filter on — never raw scan flags, which mark a
    pending review, not a finding. `allow_downloads=None` means the artist has
    no preferences row, i.e. the default (on).
    """
    if is_private:
        return "private"
    if support_gate is not None:
        return "gated"
    if has_copyright_label(labels) and moderation_override != "allow":
        return "copyright"
    if allow_downloads is False:
        return "artist_opt_out"
    return None


# characters that break filesystems or the quoted-string header grammar
_UNSAFE = set('\\/:*?"<>|')


def download_filename(artist: str, title: str, extension: str) -> str:
    """build `artist - title.ext`, safe for filesystems."""
    stem = f"{artist} - {title}" if artist else title
    cleaned = "".join(c for c in stem if c not in _UNSAFE and c.isprintable())
    cleaned = " ".join(cleaned.split()).strip(". ") or "track"
    return f"{cleaned}.{extension}"
