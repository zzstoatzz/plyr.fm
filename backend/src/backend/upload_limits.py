"""Shared file-size contract for admission and transcoding."""

import json
from importlib.resources import files

_contract = json.loads(files("backend").joinpath("upload_contract.json").read_text())
MAX_FILE_BYTES: int = _contract["max_file_bytes"]
PAUSED_UPLOAD_DIDS: frozenset[str] = frozenset(_contract["paused_upload_dids"])
