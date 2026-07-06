"""subsonic compatibility tests.

these run the real app on a live uvicorn server and drive it with py-sonic
(`libsonic`), an unmodified off-the-shelf subsonic client library — the same
protocol stack a real subsonic app (Symfonium, play:Sub, Sonixd, ...) uses.
that exercises the wire format for real: `.view` paths, `f=json`, both auth
schemes, and the full stream redirect chain out to the (stubbed) CDN origin.
"""

import asyncio
import socket
import threading
from collections.abc import AsyncGenerator, Generator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import libsonic
import pytest
import uvicorn
from libsonic.errors import CredentialError, SonicError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import create_session
from backend.main import app
from backend.models import Artist, Playlist, Track

AUDIO_BYTES = b"ID3\x03\x00fake-mp3-payload-for-subsonic-stream-test"
DID = "did:plc:subsonicuser"
HANDLE = "subsonic.test"

OAUTH_SESSION = {
    "did": DID,
    "handle": HANDLE,
    "pds_url": "https://test.pds",
    "authserver_iss": "https://auth.test",
    "scope": "atproto transition:generic",
    "access_token": "test_token",
    "refresh_token": "test_refresh",
    "dpop_private_key_pem": "fake_key",
    "dpop_authserver_nonce": "",
    "dpop_pds_nonce": "",
}


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class _OriginHandler(BaseHTTPRequestHandler):
    """stands in for the R2/CDN origin that /audio redirects point at."""

    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(AUDIO_BYTES)))
        self.end_headers()
        self.wfile.write(AUDIO_BYTES)

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture
def audio_origin() -> Generator[str, None, None]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _OriginHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    thread.join()


@pytest.fixture
async def live_server() -> AsyncGenerator[str, None]:
    """run the real app on a live port in the test's event loop."""
    port = _free_port()
    config = uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"
    )
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    await task


@pytest.fixture
async def dev_token(db_session: AsyncSession) -> str:
    return await create_session(
        DID,
        HANDLE,
        dict(OAUTH_SESSION),
        is_developer_token=True,
        token_name="subsonic-test",
    )


@pytest.fixture
async def library(db_session: AsyncSession, audio_origin: str) -> dict[str, object]:
    """an artist with two tracks and a private playlist ordering them [2, 1]."""
    artist = Artist(did=DID, handle=HANDLE, display_name="Subsonic Tester")
    db_session.add(artist)
    track_one = Track(
        title="first upload",
        file_id="subsonic_file_1",
        file_type="mp3",
        artist_did=DID,
        atproto_record_uri=f"at://{DID}/fm.plyr.track/one",
        r2_url=f"{audio_origin}/subsonic_file_1.mp3",
        image_url=f"{audio_origin}/cover1.webp",
        extra={"duration": 111},
    )
    track_two = Track(
        title="second upload",
        file_id="subsonic_file_2",
        file_type="mp3",
        artist_did=DID,
        atproto_record_uri=f"at://{DID}/fm.plyr.track/two",
        r2_url=f"{audio_origin}/subsonic_file_2.mp3",
        extra={"duration": 222},
    )
    db_session.add_all([track_one, track_two])
    playlist = Playlist(
        owner_did=DID,
        name="late night",
        is_private=True,
        items_json=[
            {"uri": track_two.atproto_record_uri, "cid": ""},
            {"uri": track_one.atproto_record_uri, "cid": ""},
        ],
        track_count=2,
    )
    db_session.add(playlist)
    await db_session.commit()
    await db_session.refresh(track_one)
    await db_session.refresh(track_two)
    return {"tracks": [track_one, track_two], "playlist": playlist}


def _connection(base_url: str, token: str, **kwargs: object) -> libsonic.Connection:
    host, _, port = base_url.rpartition(":")
    return libsonic.Connection(
        host,
        username=HANDLE,
        password=token,
        port=int(port),
        appName="plyr-test",
        **kwargs,
    )


async def test_ping_with_subsonic_token_auth(live_server: str, dev_token: str) -> None:
    """the default libsonic auth scheme: t=md5(password+salt), s=salt."""
    conn = _connection(live_server, dev_token)
    assert await asyncio.to_thread(conn.ping) is True


async def test_ping_with_legacy_password_auth(live_server: str, dev_token: str) -> None:
    """legacy auth: the token travels as p=enc:<hex>."""
    conn = _connection(live_server, dev_token, legacyAuth=True)
    assert await asyncio.to_thread(conn.ping) is True


async def test_ping_rejects_bad_token(live_server: str, dev_token: str) -> None:
    conn = _connection(live_server, "not-a-real-token")
    with pytest.raises(CredentialError):
        await asyncio.to_thread(conn.ping)


async def test_get_playlists(
    live_server: str, dev_token: str, library: dict[str, object]
) -> None:
    conn = _connection(live_server, dev_token)
    result = await asyncio.to_thread(conn.getPlaylists)
    playlists = result["playlists"]["playlist"]
    assert [p["name"] for p in playlists] == ["late night"]
    assert playlists[0]["songCount"] == 2


async def test_get_playlist_entries_in_order(
    live_server: str, dev_token: str, library: dict[str, object]
) -> None:
    conn = _connection(live_server, dev_token)
    playlists = await asyncio.to_thread(conn.getPlaylists)
    playlist_id = playlists["playlists"]["playlist"][0]["id"]
    result = await asyncio.to_thread(conn.getPlaylist, playlist_id)
    entries = result["playlist"]["entry"]
    assert [e["title"] for e in entries] == ["second upload", "first upload"]
    assert [e["duration"] for e in entries] == [222, 111]
    assert result["playlist"]["duration"] == 333
    assert all(e["artist"] == "Subsonic Tester" for e in entries)


async def test_stream_returns_audio_bytes(
    live_server: str, dev_token: str, library: dict[str, object]
) -> None:
    """stream follows the redirect chain /rest/stream → /audio/{file_id} → origin."""
    conn = _connection(live_server, dev_token)
    track = library["tracks"][0]  # type: ignore[index]
    response = await asyncio.to_thread(conn.stream, str(track.id))
    assert response.read() == AUDIO_BYTES


async def test_get_cover_art_returns_bytes(
    live_server: str, dev_token: str, library: dict[str, object]
) -> None:
    conn = _connection(live_server, dev_token)
    track = library["tracks"][0]  # type: ignore[index]
    response = await asyncio.to_thread(conn.getCoverArt, str(track.id))
    assert (
        response.read() == AUDIO_BYTES
    )  # origin stub serves one payload for all paths


async def test_stream_refuses_gated_track(
    live_server: str, dev_token: str, db_session: AsyncSession, audio_origin: str
) -> None:
    artist = Artist(did=DID, handle=HANDLE, display_name="Subsonic Tester")
    db_session.add(artist)
    track = Track(
        title="supporters only",
        file_id="subsonic_gated",
        file_type="mp3",
        artist_did=DID,
        r2_url=f"{audio_origin}/gated.mp3",
        support_gate={"type": "any"},
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    conn = _connection(live_server, dev_token)
    with pytest.raises(SonicError):
        await asyncio.to_thread(conn.stream, str(track.id))


async def test_xml_is_the_default_format(live_server: str, dev_token: str) -> None:
    """clients that don't send f=json get the xml envelope."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{live_server}/rest/ping.view", params={"u": HANDLE, "p": dev_token}
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/xml")
    assert response.text.startswith('<?xml version="1.0"')
    assert 'status="ok"' in response.text
    assert 'xmlns="http://subsonic.org/restapi"' in response.text


async def test_get_album_list2_and_get_album(
    live_server: str,
    dev_token: str,
    library: dict[str, object],
    db_session: AsyncSession,
) -> None:
    """album browsing: the home-screen sync amperfy does on every launch."""
    from backend.models import Album

    album = Album(artist_did=DID, slug="demo", title="demo album")
    db_session.add(album)
    await db_session.flush()
    track = library["tracks"][0]  # type: ignore[index]
    track.album_id = album.id
    await db_session.commit()

    conn = _connection(live_server, dev_token)
    result = await asyncio.to_thread(lambda: conn.getAlbumList2(ltype="newest"))
    albums = result["albumList2"]["album"]
    assert [a["name"] for a in albums] == ["demo album"]
    assert albums[0]["songCount"] == 1

    detail = await asyncio.to_thread(conn.getAlbum, albums[0]["id"])
    songs = detail["album"]["song"]
    assert [s["title"] for s in songs] == ["first upload"]
    # offline-first clients resolve album views by these linkage fields
    assert songs[0]["albumId"] == albums[0]["id"]
    assert songs[0]["parent"] == albums[0]["id"]
    assert songs[0]["artistId"] == DID


async def test_scrobble_increments_play_count(
    live_server: str,
    dev_token: str,
    library: dict[str, object],
    db_session: AsyncSession,
) -> None:
    track = library["tracks"][0]  # type: ignore[index]
    assert track.play_count == 0
    conn = _connection(live_server, dev_token)
    await asyncio.to_thread(lambda: conn.scrobble(sid=str(track.id), submission=True))
    await db_session.refresh(track)
    assert track.play_count == 1
    # now-playing notifications (submission=false) are acknowledged, not counted
    await asyncio.to_thread(lambda: conn.scrobble(sid=str(track.id), submission=False))
    await db_session.refresh(track)
    assert track.play_count == 1


async def test_unknown_method_returns_error_envelope_not_404(
    live_server: str, dev_token: str
) -> None:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{live_server}/rest/getStarred2.view",
            params={"u": HANDLE, "p": dev_token, "f": "json"},
        )
    assert response.status_code == 200
    body = response.json()["subsonic-response"]
    assert body["status"] == "failed"
    assert "not implemented" in body["error"]["message"]


async def test_subsonic_routes_stay_out_of_openapi_schema() -> None:
    """the /rest surface is experimental — it must not appear in the API reference."""
    paths = app.openapi()["paths"]
    assert not [p for p in paths if p.startswith("/rest")]


async def test_envelope_carries_opensubsonic_fields(
    live_server: str, dev_token: str
) -> None:
    """opensubsonic-era clients decode serverVersion/openSubsonic as required."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{live_server}/rest/ping",
            params={"u": HANDLE, "p": dev_token, "f": "json"},
        )
    body = response.json()["subsonic-response"]
    assert body["openSubsonic"] is True
    assert isinstance(body["serverVersion"], str) and body["serverVersion"]
