"""shared response schemas for API endpoints."""

from typing import Any

from pydantic import BaseModel

from backend.models import Album, Track
from backend.utilities.aggregations import CopyrightInfo

# --- common simple response types ---


class OkResponse(BaseModel):
    """simple success response."""

    ok: bool = True


class StatusResponse(BaseModel):
    """status response for operations that return a status string."""

    status: str


class MessageResponse(BaseModel):
    """response containing a message."""

    message: str


class DeletedResponse(BaseModel):
    """response for delete operations."""

    deleted: bool = True


class LikedResponse(BaseModel):
    """response for like/unlike operations."""

    liked: bool


class PlayCountResponse(BaseModel):
    """response for play count increment."""

    play_count: int


class AlbumSummary(BaseModel):
    """album summary for embedding in track responses."""

    id: str
    slug: str
    title: str
    image_url: str | None

    @classmethod
    async def from_album(
        cls, album: Album, artist_avatar_url: str | None = None
    ) -> "AlbumSummary":
        """build album summary from Album model."""
        image_url = album.image_url
        if not image_url and album.image_id:
            image_url = await album.get_image_url()
        if not image_url and artist_avatar_url:
            image_url = artist_avatar_url

        return cls(
            id=album.id,
            slug=album.slug,
            title=album.title,
            image_url=image_url,
        )


class FeaturedArtist(BaseModel):
    """featured artist metadata."""

    did: str
    handle: str
    display_name: str


class TrackResponse(BaseModel):
    """track response schema."""

    id: int
    title: str
    artist: str
    artist_handle: str
    artist_did: str
    artist_avatar_url: str | None
    file_id: str
    file_type: str
    features: list[dict[str, Any]]
    r2_url: str | None
    atproto_record_uri: str | None
    atproto_record_cid: str | None
    atproto_record_url: str | None
    play_count: int
    created_at: str
    image_url: str | None
    is_liked: bool
    like_count: int
    comment_count: int
    album: AlbumSummary | None
    tags: set[str] = set()
    copyright_flagged: bool | None = (
        None  # None = not scanned, False = clear, True = flagged
    )
    copyright_match: str | None = None  # "Title by Artist" of primary match
    support_gate: dict[str, Any] | None = None  # supporter gating config
    gated: bool = False  # true if track is gated AND viewer lacks access
    original_file_id: str | None = None  # original file hash if transcoded
    original_file_type: str | None = (
        None  # original format if transcoded (e.g., aiff, flac)
    )

    @classmethod
    async def from_track(
        cls,
        track: Track,
        pds_url: str | None = None,
        liked_track_ids: set[int] | None = None,
        like_counts: dict[int, int] | None = None,
        comment_counts: dict[int, int] | None = None,
        copyright_info: dict[int, CopyrightInfo] | None = None,
        track_tags: dict[int, set[str]] | None = None,
        viewer_did: str | None = None,
        supported_artist_dids: set[str] | None = None,
    ) -> "TrackResponse":
        """build track response from Track model.

        args:
            track: Track model instance
            pds_url: optional PDS URL for atproto_record_url
            liked_track_ids: optional set of liked track IDs for this user
            like_counts: optional dict of track_id -> like_count
            comment_counts: optional dict of track_id -> comment_count
            copyright_info: optional dict of track_id -> CopyrightInfo
            track_tags: optional dict of track_id -> set of tag names
            viewer_did: optional DID of the viewer (for gated content resolution)
            supported_artist_dids: optional set of artist DIDs the viewer supports
        """
        # check if user has liked this track
        is_liked = liked_track_ids is not None and track.id in liked_track_ids

        # get like count
        like_count = like_counts.get(track.id, 0) if like_counts else 0

        # get comment count
        comment_count = comment_counts.get(track.id, 0) if comment_counts else 0

        # resolve image URL
        image_url = track.image_url
        if not image_url and track.image_id:
            image_url = await track.get_image_url()

        # serialize album if present
        album_data: AlbumSummary | None = None
        if track.album_id and track.album_rel:
            album_data = await AlbumSummary.from_album(
                track.album_rel,
                artist_avatar_url=track.artist.avatar_url,
            )

        # construct atproto record URL
        atproto_record_url: str | None = None
        if track.atproto_record_uri and pds_url:
            from backend.config import settings

            rkey = track.atproto_record_uri.split("/")[-1]
            atproto_record_url = (
                f"{pds_url}/xrpc/com.atproto.repo.getRecord"
                f"?repo={track.artist_did}&collection={settings.atproto.track_collection}"
                f"&rkey={rkey}"
            )

        # get copyright info (None if not in dict = not scanned)
        track_copyright = copyright_info.get(track.id) if copyright_info else None
        copyright_flagged = track_copyright.is_flagged if track_copyright else None
        copyright_match = track_copyright.primary_match if track_copyright else None

        # get tags for this track
        tags = track_tags.get(track.id, set()) if track_tags else set()

        # resolve gated status for viewer
        # gated = true only if track has support_gate AND viewer lacks access
        gated = False
        if track.support_gate:
            is_owner = viewer_did and viewer_did == track.artist_did
            is_supporter = (
                supported_artist_dids and track.artist_did in supported_artist_dids
            )
            gated = not (is_owner or is_supporter)

        return cls(
            id=track.id,
            title=track.title,
            artist=track.artist.display_name,
            artist_handle=track.artist.handle,
            artist_did=track.artist_did,
            artist_avatar_url=track.artist.avatar_url,
            file_id=track.file_id,
            file_type=track.file_type,
            features=track.features,
            r2_url=track.r2_url,
            atproto_record_uri=track.atproto_record_uri,
            atproto_record_cid=track.atproto_record_cid,
            atproto_record_url=atproto_record_url,
            play_count=track.play_count,
            created_at=track.created_at.isoformat(),
            image_url=image_url,
            is_liked=is_liked,
            like_count=like_count,
            comment_count=comment_count,
            album=album_data,
            tags=tags,
            copyright_flagged=copyright_flagged,
            copyright_match=copyright_match,
            support_gate=track.support_gate,
            gated=gated,
            original_file_id=track.original_file_id,
            original_file_type=track.original_file_type,
        )
