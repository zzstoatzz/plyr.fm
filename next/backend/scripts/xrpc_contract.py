"""The unspecced XRPC methods: run by test_http.py against its server."""

from __future__ import annotations

import json
import urllib.parse
from collections.abc import Callable
from typing import Any


def assert_xrpc_methods(
    base_url: str, request: Callable[..., Any], collection: str
) -> None:
    """The fm.plyr.dev.unspecced.* XRPC methods, index disabled."""
    xrpc = "/xrpc/fm.plyr.dev.unspecced."
    song = f"at://did:plc:artist/{collection}/song"
    album = "at://did:plc:artist/fm.plyr.dev.list/album"
    quoted = urllib.parse.quote
    # every method reaches its handler, which reports the missing index
    for target in (
        "listTracks?limit=2&artistDid=did%3Aplc%3Aartist&hiddenTag=ai",
        f"getTrack?uri={quoted(song, safe='')}",
        "getTrack?legacyId=42",
        f"getPlayback?uri={quoted(song, safe='')}",
        f"getTrackLikes?uri={quoted(song, safe='')}&limit=5",
        "getTrackChart?period=week&limit=5",
        "search?q=ambient",
        "getStats",
        "getStatsOverview?range=week",
        "listAlbums?artistDid=did%3Aplc%3Aartist",
        f"getAlbum?uri={quoted(album, safe='')}",
        "listPlaylists?limit=5",
        "getArtist?actor=did%3Aplc%3Aartist",
        "getActorLikes?actor=did%3Aplc%3Aartist",
    ):
        status, _, body = request(base_url, xrpc + target)
        assert status == 503, (target, status, body)
        assert body == {
            "error": "ServiceUnavailable",
            "message": "The service is temporarily unavailable.",
        }, (target, body)

    status, _, body = request(
        base_url,
        xrpc + "resolveTracks",
        method="POST",
        data=json.dumps({"uris": [song]}).encode(),
    )
    assert status == 503, body

    # XRPC names only, a subject where one is needed, and the right verb
    for target in (
        "listTracks?artist_did=did%3Aplc%3Aartist",
        "listTracks?limit=0",
        "getTrack",
        "getTrack?uri=not-a-uri",
        f"getTrack?uri={quoted(song, safe='')}&legacyId=42",
        "getArtist",
        "getActorLikes?actor=artist.example",
        "getStatsOverview?range=day",
    ):
        status, _, body = request(base_url, xrpc + target)
        assert status == 400, (target, status, body)
        assert body["error"] == "InvalidRequest", (target, body)
    status, _, body = request(
        base_url, xrpc + "resolveTracks", method="POST", data=b'{"ids":[]}'
    )
    assert status == 400 and body["error"] == "InvalidRequest", body
    status, _, body = request(base_url, xrpc + "getStats", method="POST", data=b"")
    assert status == 405 and body["error"] == "MethodNotAllowed", body
    status, _, body = request(base_url, xrpc + "resolveTracks")
    assert status == 405, body

    # a record in another deployment's collection is not ours
    foreign = quoted("at://did:plc:artist/fm.plyr.track/song", safe="")
    status, _, body = request(base_url, xrpc + f"getTrack?uri={foreign}")
    assert status == 404 and body["error"] == "NotFound", body

    status, _, body = request(base_url, xrpc + "getNothing")
    assert status == 404 and body["error"] == "NotFound", body
