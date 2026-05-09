"""NSID constants for plyr.fm spaces and the records they contain.

space TYPE NSIDs describe the modality / OAuth consent boundary
(``what kind of space is this``). record COLLECTION NSIDs describe
record shape and are reused across public and private storage —
a playlist is a playlist regardless of where it lives.
"""

# space type nsids — one per modality / oauth consent boundary
PERSONAL_SPACE_TYPE = "fm.plyr.personal"
"""personal space: a user's own private stuff (playlists, drafts, history).
single-member, owner-only."""

# record collection nsids — same as their public counterparts
PLAYLIST_COLLECTION = "fm.plyr.playlist"
"""a playlist record — name, items, image. same shape public or private."""
