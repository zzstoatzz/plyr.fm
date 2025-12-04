"""audio file utilities."""

import io
import logging
from typing import BinaryIO

from mutagen import File as MutagenFile

logger = logging.getLogger(__name__)


def extract_duration(audio_data: bytes | BinaryIO) -> int | None:
    """extract duration from audio file data.

    args:
        audio_data: raw audio bytes or file-like object

    returns:
        duration in seconds, or None if extraction fails
    """
    try:
        if isinstance(audio_data, bytes):
            audio_data = io.BytesIO(audio_data)

        audio = MutagenFile(audio_data)
        if audio is None:
            logger.warning("mutagen could not identify audio format")
            return None

        if audio.info is None:
            logger.warning("audio file has no info")
            return None

        duration = getattr(audio.info, "length", None)
        if duration is None:
            logger.warning("audio file has no length info")
            return None

        return int(duration)

    except Exception as e:
        logger.warning(f"failed to extract duration: {e}")
        return None
