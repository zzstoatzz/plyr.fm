"""the image-flag DM names and links whatever is using the flagged image.

regression: on 2026-10-18 a gore flag arrived as only "context: album cover"
plus an image_id, so finding the album (renderg.host's "resmashed") took a DB
query. image ids are content hashes, so one flag can cover several rows.
"""

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from atproto import client_utils, models
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.clients.moderation import ScanImageResult
from backend._internal.notifications import NotificationResult, notification_service
from backend._internal.tasks.moderation import scan_image_moderation
from backend.models import Album, Artist, Playlist, Track

IMAGE_ID = "19a2f037af16e8c9"
RECIPIENT = "did:plc:operator"


@pytest.fixture
def sent_dm() -> Iterator[AsyncMock]:
    """drive scan_image_moderation with only the image fetch, scan and DM faked."""
    image_response = MagicMock(content=b"jpeg-bytes")
    http = AsyncMock()
    http.get.return_value = image_response
    moderation = AsyncMock()
    moderation.scan_image.return_value = ScanImageResult(
        is_safe=False,
        reason="gore",
        severity="high",
        violated_categories=["Extreme violence or gore"],
    )
    with (
        patch("backend._internal.tasks.moderation.httpx.AsyncClient") as client_cls,
        patch(
            "backend._internal.tasks.moderation.get_moderation_client",
            return_value=moderation,
        ),
        patch.object(notification_service, "recipient_did", RECIPIENT),
        patch.object(
            notification_service,
            "_send_dm_to_did",
            new_callable=AsyncMock,
            return_value=NotificationResult(success=True, recipient_did=RECIPIENT),
        ) as send,
        patch("backend._internal.notifications.settings") as notif_settings,
    ):
        client_cls.return_value.__aenter__.return_value = http
        notif_settings.app.name = "plyr.fm"
        notif_settings.observability.environment = "staging"
        notif_settings.frontend.url = "https://stg.plyr.fm"
        yield send


async def _flag(sent_dm: AsyncMock) -> client_utils.TextBuilder:
    await scan_image_moderation(
        IMAGE_ID, f"https://images.example/{IMAGE_ID}.jpg", "image/jpeg", "album"
    )
    assert sent_dm.await_args is not None
    recipient, message = sent_dm.await_args.args
    assert recipient == RECIPIENT
    assert isinstance(message, client_utils.TextBuilder)
    return message


def _links(message: client_utils.TextBuilder) -> list[str]:
    return [
        feature.uri
        for facet in message.build_facets()
        for feature in facet.features
        if isinstance(feature, models.AppBskyRichtextFacet.Link)
    ]


async def test_flag_links_the_album_and_artist(
    db_session: AsyncSession, sent_dm: AsyncMock
) -> None:
    db_session.add(
        Artist(
            did="did:plc:renderg", handle="renderg.host", display_name="renderg.host"
        )
    )
    await db_session.flush()
    db_session.add(
        Album(
            artist_did="did:plc:renderg",
            slug="resmashed",
            title="resmashed",
            image_id=IMAGE_ID,
        )
    )
    await db_session.commit()

    message = await _flag(sent_dm)

    assert message.build_text() == (
        "🚨 image flagged on plyr.fm [staging]\n\n"
        "used by:\n"
        "- album 'resmashed' by @renderg.host\n"
        "\ncontext: album cover\n"
        "severity: high\n"
        "categories: Extreme violence or gore\n"
        f"image_id: {IMAGE_ID}"
    )
    assert _links(message) == [
        "https://stg.plyr.fm/u/renderg.host/album/resmashed",
        "https://stg.plyr.fm/u/renderg.host",
    ]


async def test_flag_lists_every_row_sharing_the_image(
    db_session: AsyncSession, sent_dm: AsyncMock
) -> None:
    db_session.add_all(
        [
            Artist(did="did:plc:a", handle="a.test", display_name="a.test"),
            Artist(did="did:plc:b", handle="b.test", display_name="b.test"),
        ]
    )
    await db_session.flush()
    track = Track(
        title="smash",
        file_id="file-smash",
        file_type="mp3",
        artist_did="did:plc:a",
        image_id=IMAGE_ID,
    )
    playlist = Playlist(
        id="pl-1",
        owner_did="did:plc:b",
        name="secret mix",
        is_private=True,
        image_id=IMAGE_ID,
    )
    db_session.add_all(
        [
            Album(artist_did="did:plc:a", slug="lp", title="LP", image_id=IMAGE_ID),
            track,
            playlist,
            Album(artist_did="did:plc:b", slug="other", title="other"),
        ]
    )
    await db_session.commit()

    message = await _flag(sent_dm)

    assert message.build_text().split("\n\n")[1] == (
        "used by:\n"
        "- album 'LP' by @a.test\n"
        "- playlist (private) 'secret mix' by @b.test\n"
        "- track 'smash' by @a.test"
    )
    assert _links(message) == [
        "https://stg.plyr.fm/u/a.test/album/lp",
        "https://stg.plyr.fm/u/a.test",
        "https://stg.plyr.fm/playlist/pl-1",
        "https://stg.plyr.fm/u/b.test",
        f"https://stg.plyr.fm/track/{track.id}",
        "https://stg.plyr.fm/u/a.test",
    ]


async def test_flag_with_no_owner_yet_still_sends(
    db_session: AsyncSession, sent_dm: AsyncMock
) -> None:
    message = await _flag(sent_dm)

    assert "used by: nothing yet\n" in message.build_text()
    assert f"image_id: {IMAGE_ID}" in message.build_text()
    assert _links(message) == []
