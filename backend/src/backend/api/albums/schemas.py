"""pydantic models for album endpoints."""

from pydantic import BaseModel


class AlbumMetadata(BaseModel):
    """album metadata response."""

    id: str
    title: str
    slug: str
    description: str | None = None
    artist: str
    artist_handle: str
    artist_did: str
    track_count: int
    total_plays: int
    image_url: str | None
    list_uri: str | None = None  # ATProto list record URI for reordering


class AlbumResponse(BaseModel):
    """album detail response with tracks."""

    metadata: AlbumMetadata
    tracks: list[dict]


class AlbumListItem(BaseModel):
    """minimal album info for listing."""

    id: str
    title: str
    slug: str
    artist: str
    artist_handle: str
    track_count: int


class RemoveTrackFromAlbumResponse(BaseModel):
    """response for removing a track from an album."""

    removed: bool = True
    track_id: int


class DeleteAlbumResponse(BaseModel):
    """response for deleting an album."""

    deleted: bool = True
    cascade: bool


class ArtistAlbumListItem(BaseModel):
    """album info for a specific artist (used on artist pages)."""

    id: str
    title: str
    slug: str
    track_count: int
    total_plays: int
    image_url: str | None


class AlbumCreatePayload(BaseModel):
    title: str
    slug: str | None = None
    description: str | None = None


class AlbumUpdatePayload(BaseModel):
    title: str | None = None
    slug: str | None = None
    description: str | None = None


class AlbumFinalizePayload(BaseModel):
    """request body for POST /albums/{id}/finalize.

    track_ids is the authoritative user-intended order for the album's
    ATProto list record. every id must belong to this album and have a
    completed PDS write (atproto_record_uri + cid set).
    """

    track_ids: list[int]
