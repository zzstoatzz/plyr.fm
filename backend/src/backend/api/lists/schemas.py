"""pydantic schemas for list endpoints."""

from pydantic import BaseModel

from backend.schemas import TrackResponse

# --- playlist schemas ---


class CreatePlaylistRequest(BaseModel):
    """request body for creating a playlist."""

    name: str
    """display name for the playlist."""

    is_private: bool = False
    """when true, the playlist is owner-only and not pushed to the user's PDS.
    cannot be toggled after creation in v0."""


class PlaylistResponse(BaseModel):
    """playlist metadata response."""

    id: str
    name: str
    owner_did: str
    owner_handle: str
    track_count: int
    image_url: str | None
    show_on_profile: bool
    atproto_record_uri: str | None
    """null for private playlists (no public ATProto record)."""
    is_private: bool
    created_at: str
    preview_thumbnails: list[str] = []
    """up to 4 distinct member-track artwork URLs, in playlist order.
    clients render a composite cover from these when `image_url` is null."""


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
