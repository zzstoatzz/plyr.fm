"""pydantic schemas for list endpoints."""

from pydantic import BaseModel

from backend.schemas import TrackResponse

# --- playlist schemas ---


class CreatePlaylistRequest(BaseModel):
    """request body for creating a playlist."""

    name: str
    """display name for the playlist."""


class PlaylistResponse(BaseModel):
    """playlist metadata response."""

    id: str
    name: str
    owner_did: str
    owner_handle: str
    track_count: int
    image_url: str | None
    show_on_profile: bool
    atproto_record_uri: str
    created_at: str


class PlaylistWithTracksResponse(PlaylistResponse):
    """playlist with full track details."""

    tracks: list[TrackResponse]
    """ordered list of track details."""


class AddTrackRequest(BaseModel):
    """request body for adding a track to a playlist."""

    track_uri: str
    """ATProto URI of the track to add."""
    track_cid: str
    """CID of the track to add."""


class ReorderRequest(BaseModel):
    """request body for reordering list items."""

    items: list[dict[str, str]]
    """ordered array of strongRefs (uri + cid). array order = display order."""


class ReorderResponse(BaseModel):
    """response from reorder operation."""

    uri: str
    cid: str


class RecommendedTrack(BaseModel):
    """a recommended track for a playlist."""

    id: int
    title: str
    artist_handle: str
    artist_display_name: str
    image_url: str | None


class PlaylistRecommendationsResponse(BaseModel):
    """response for playlist recommendations."""

    tracks: list[RecommendedTrack]
    available: bool
