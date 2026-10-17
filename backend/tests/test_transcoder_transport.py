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
