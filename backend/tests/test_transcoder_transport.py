"""Exercise error handling over a real HTTP connection."""

import asyncio
from pathlib import Path

import pytest

from backend._internal.clients.transcoder import TranscoderClient


@pytest.mark.parametrize("status", [413, 500])
async def test_streamed_http_error_keeps_its_status(
    tmp_path: Path, status: int
) -> None:
    async def respond(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        headers = await reader.readuntil(b"\r\n\r\n")
        length = next(
            int(line.split(b":", 1)[1])
            for line in headers.split(b"\r\n")
            if line.lower().startswith(b"content-length:")
        )
        await reader.readexactly(length)
        body = b"file exceeds upload limit"
        writer.write(
            f"HTTP/1.1 {status} Error\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
            + body
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    async with await asyncio.start_server(respond, "127.0.0.1", 0) as server:
        source = tmp_path / "input.flac"
        source.write_bytes(b"fLaC")
        client = TranscoderClient(
            f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}", "test", 5, "mp3"
        )
        result = await client.transcode_file(source, "flac", tmp_path / "output.mp3")
    assert not result.success
    assert (
        result.error
        == f"transcode service returned {status}: file exceeds upload limit"
    )


@pytest.mark.parametrize("outcome", ["success", "timeout", "cancel"])
async def test_heartbeat_covers_encoding_wait_and_stops_with_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, outcome: str
) -> None:
    monkeypatch.setattr(
        "backend._internal.clients.transcoder._HEARTBEAT_INTERVAL_SECONDS", 0.02
    )
    received = asyncio.Event()
    release = asyncio.Event()
    disconnected = asyncio.Event()
    beats = 0
    heartbeat_seen = asyncio.Event()

    async def heartbeat() -> None:
        nonlocal beats
        beats += 1
        if beats == 1:
            raise RuntimeError("temporary heartbeat failure")
        heartbeat_seen.set()

    async def respond(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            headers = await reader.readuntil(b"\r\n\r\n")
            length = next(
                int(line.split(b":", 1)[1])
                for line in headers.split(b"\r\n")
                if line.lower().startswith(b"content-length:")
            )
            await reader.readexactly(length)
            received.set()
            await release.wait()
            if outcome == "success":
                writer.write(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nmp3"
                )
                await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
            disconnected.set()

    async with await asyncio.start_server(respond, "127.0.0.1", 0) as server:
        source = tmp_path / "input.mp3"
        source.write_bytes(b"audio")
        destination = tmp_path / "output.mp3"
        client = TranscoderClient(
            f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}",
            "test",
            0.5 if outcome == "timeout" else 5,
            "mp3",
        )
        request = asyncio.create_task(
            client.transcode_file(source, "mp3", destination, heartbeat=heartbeat)
        )
        try:
            await asyncio.wait_for(received.wait(), 2)
            await asyncio.wait_for(heartbeat_seen.wait(), 0.3)
            assert not request.done()
            if outcome == "cancel":
                request.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await request
            else:
                if outcome == "success":
                    release.set()
                result = await asyncio.wait_for(request, 2)
                assert result.success is (outcome == "success")
                if outcome == "success":
                    assert destination.read_bytes() == b"mp3"
                else:
                    assert result.error is not None
                    assert "timed out" in result.error
            finished_beats = beats
            await asyncio.sleep(0.08)
            assert beats == finished_beats
        finally:
            request.cancel()
            await asyncio.gather(request, return_exceptions=True)
            release.set()
            await asyncio.wait_for(disconnected.wait(), 2)
