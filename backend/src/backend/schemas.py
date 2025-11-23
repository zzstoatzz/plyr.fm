"""shared response schemas for API endpoints."""

from typing import Any

from pydantic import BaseModel

from backend.models import Album, Track


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
    artist_avatar_url: str | None
    file_id: str
    file_type: str
    features: list[dict[str, Any]]
    r2_url: str | None
    atproto_record_uri: str | None
    atproto_record_url: str | None
    play_count: int
    created_at: str
    image_url: str | None
    is_liked: bool
    like_count: int
    album: AlbumSummary | None

    @classmethod
    async def from_track(
        cls,
        track: Track,
        pds_url: str | None = None,
        liked_track_ids: set[int] | None = None,
        like_counts: dict[int, int] | None = None,
    ) -> "TrackResponse":
        """build track response from Track model.

        args:
            track: Track model instance
            pds_url: optional PDS URL for atproto_record_url
            liked_track_ids: optional set of liked track IDs for this user
            like_counts: optional dict of track_id -> like_count
        """
        # check if user has liked this track
        is_liked = liked_track_ids is not None and track.id in liked_track_ids

        # get like count
        like_count = like_counts.get(track.id, 0) if like_counts else 0

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

        return cls(
            id=track.id,
            title=track.title,
            artist=track.artist.display_name,
            artist_handle=track.artist.handle,
            artist_avatar_url=track.artist.avatar_url,
            file_id=track.file_id,
            file_type=track.file_type,
            features=track.features,
            r2_url=track.r2_url,
            atproto_record_uri=track.atproto_record_uri,
            atproto_record_url=atproto_record_url,
            play_count=track.play_count,
            created_at=track.created_at.isoformat(),
            image_url=image_url,
            is_liked=is_liked,
            like_count=like_count,
            album=album_data,
        )
