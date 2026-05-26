"""regression for issue #1444 — track edits failing to sync to ATProto.

`beartype_this_package()` runtime-checks every function in the backend, so
annotation types must be resolvable at runtime. `rebuild_track_pds_record` was
annotated `track: "Track"` with `Track` imported only under `TYPE_CHECKING`,
so the first track-body edit raised `BeartypeCallHintForwardRefException` on the
edit -> PDS-sync path and returned a 500 ("can't save changes when editing
track"). this guards the annotation against being re-hidden behind TYPE_CHECKING.
"""

from unittest.mock import MagicMock

from backend._internal import Session
from backend._internal.atproto.records.fm_plyr.track import rebuild_track_pds_record
from backend.models import Track


async def test_rebuild_track_pds_record_passes_beartype() -> None:
    # spec= so beartype's isinstance() checks for `track`/`auth_session` pass.
    # if `Track` were a TYPE_CHECKING-only forward ref, beartype would raise
    # BeartypeCallHintForwardRefException before this body ever ran.
    track = MagicMock(spec=Track)
    track.atproto_record_uri = None  # early-return: no PDS call, no other deps

    result = await rebuild_track_pds_record(track, MagicMock(spec=Session))

    assert result is None
