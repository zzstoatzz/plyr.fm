"""Drive the real async S3 copy protocol against a local object server."""

import asyncio
import hashlib
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from urllib.parse import unquote
from xml.etree import ElementTree

import aioboto3
import pytest
from aiohttp import web
from botocore.exceptions import ClientError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.jobs import job_service
from backend.api.tracks import uploads
from backend.models.job import JobType
from backend.storage import _promotion
from backend.storage.keys import AudioKey, StagedUploadKey
from backend.storage.r2 import IMMUTABLE_CACHE_CONTROL, R2Storage


@dataclass
class ObjectServer:
    objects: dict[str, bytes] = field(default_factory=dict)
    etags: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, dict[str, str]] = field(default_factory=dict)
    parts: dict[int, bytes] = field(default_factory=dict)
    events: list[str] = field(default_factory=list)
    ranges: list[str] = field(default_factory=list)
    completed: list[int] = field(default_factory=list)
    fail: str | None = None
    waiting: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)
    url: str = ""

    async def handle(self, request: web.Request) -> web.Response:
        path = request.path.lstrip("/")
        query = request.query
        if request.method == "HEAD":
            self.events.append(f"head:{path}")
            if path not in self.objects:
                return web.Response(status=404)
            body = self.objects[path]
            etag = hashlib.md5(body).hexdigest()
            return web.Response(
                headers={
                    "Content-Length": str(
                        len(body)
                        + (
                            1
                            if self.fail == "size" and path.startswith("public/")
                            else 0
                        )
                    ),
                    "ETag": (
                        '"stale"'
                        if self.fail == "etag" and path.startswith("public/")
                        else self.etags.get(path, f'"{etag}"')
                    ),
                }
            )
        if request.method == "DELETE":
            if "uploadId" in query:
                self.events.append("abort")
                self.parts.clear()
            else:
                self.events.append(f"delete:{path}")
                self.objects.pop(path, None)
            return web.Response(status=204)
        if request.method == "POST" and "uploads" in query:
            self.events.append("begin")
            self.metadata[path] = {
                "content-type": request.headers["Content-Type"],
                "cache-control": request.headers["Cache-Control"],
            }
            return web.Response(
                text="<InitiateMultipartUploadResult><UploadId>copy-fixture</UploadId></InitiateMultipartUploadResult>",
                content_type="application/xml",
            )
        if request.method == "POST" and "uploadId" in query:
            self.events.append("complete")
            if self.fail == "complete":
                return self.error()
            parts = ElementTree.fromstring(await request.read())
            numbers = [int(part.findtext("{*}PartNumber") or "0") for part in parts]
            self.completed = numbers
            self.objects[path] = b"".join(self.parts[number] for number in numbers)
            etag = (
                hashlib.md5(
                    b"".join(
                        hashlib.md5(self.parts[number]).digest() for number in numbers
                    )
                ).hexdigest()
                + f"-{len(numbers)}"
            )
            self.etags[path] = f'"{etag}"'
            return web.Response(
                text=f'<CompleteMultipartUploadResult><ETag>"{etag}"</ETag></CompleteMultipartUploadResult>',
                content_type="application/xml",
            )
        if request.method == "PUT":
            self.events.append("part" if "uploadId" in query else "copy")
            if any(
                name.lower().startswith("x-amz-copy-source-if-")
                for name in request.headers
            ):
                return self.error()
            source = unquote(request.headers["x-amz-copy-source"]).lstrip("/")
            body = self.objects[source]
            if "uploadId" in query:
                if self.fail == "part":
                    return self.error()
                if self.fail == "wait":
                    self.waiting.set()
                    await self.release.wait()
                requested_range = request.headers["x-amz-copy-source-range"]
                self.ranges.append(requested_range)
                start, end = requested_range.removeprefix("bytes=").split("-")
                body = body[int(start) : int(end) + 1]
                self.parts[int(query["partNumber"])] = body
                root = "CopyPartResult"
            else:
                if self.fail == "copy" or len(body) > 8:
                    return self.error()
                self.objects[path] = body
                self.metadata[path] = {
                    "content-type": request.headers["Content-Type"],
                    "cache-control": request.headers["Cache-Control"],
                }
                assert request.headers["x-amz-metadata-directive"] == "REPLACE"
                root = "CopyObjectResult"
            etag = hashlib.md5(body).hexdigest()
            return web.Response(
                text=f'<{root}><ETag>"{etag}"</ETag></{root}>',
                content_type="application/xml",
            )
        raise AssertionError(
            f"unexpected S3 request: {request.method} {request.path_qs}"
        )

    @staticmethod
    def error() -> web.Response:
        return web.Response(
            status=400,
            text="<Error><Code>InvalidRequest</Code><Message>fixture refusal</Message></Error>",
            content_type="application/xml",
        )


@pytest.fixture
async def object_server(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[ObjectServer]:
    server = ObjectServer()
    application = web.Application()
    application.router.add_route("*", "/{path:.*}", server.handle)
    runner = web.AppRunner(application)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    server.url = f"http://127.0.0.1:{runner.addresses[0][1]}"
    monkeypatch.setattr(_promotion, "COPY_PART_BYTES", 8)
    try:
        yield server
    finally:
        server.release.set()
        await runner.cleanup()


def storage_for(server: ObjectServer) -> R2Storage:
    storage = object.__new__(R2Storage)
    storage.private_audio_bucket_name = "private"
    storage.audio_bucket_name = "public"
    storage.async_session = aioboto3.Session()
    storage._s3_kwargs = {
        "endpoint_url": server.url,
        "aws_access_key_id": "fixture-access",
        "aws_secret_access_key": "fixture-secret",
        "region_name": "auto",
    }
    return storage


def prepare(server: ObjectServer, size: int = 21) -> tuple[StagedUploadKey, AudioKey]:
    staged = StagedUploadKey(upload_id="fixture", extension="flac")
    audio = AudioKey.for_file("content-hash", "flac")
    server.objects[f"private/{staged.key}"] = bytes(range(size))
    return staged, audio


@pytest.mark.parametrize("size", [7, 8, 9, 16, 21])
@pytest.mark.parametrize("gated", [False, True])
async def test_promotes_exact_bytes_and_metadata_before_removing_staging(
    object_server: ObjectServer, size: int, gated: bool
) -> None:
    staged, audio = prepare(object_server, size)
    source = object_server.objects[f"private/{staged.key}"]
    await storage_for(object_server).promote_staged(staged, audio, gated=gated)
    destination = f"{'private' if gated else 'public'}/{audio.key}"
    assert object_server.objects[destination] == source
    assert f"private/{staged.key}" not in object_server.objects
    assert object_server.metadata[destination] == {
        "content-type": "audio/flac",
        "cache-control": IMMUTABLE_CACHE_CONTROL,
    }
    assert object_server.events[-2:] == [
        f"head:{destination}",
        f"delete:private/{staged.key}",
    ]
    if size > 8:
        assert "copy" not in object_server.events
        assert object_server.ranges == [
            f"bytes={start}-{min(start + 8, size) - 1}" for start in range(0, size, 8)
        ]
        assert object_server.completed == list(range(1, (size + 7) // 8 + 1))
    else:
        assert "copy" in object_server.events and "begin" not in object_server.events


@pytest.mark.parametrize(
    "failure", ["part", "complete", "size", "etag", "cancel", "timeout"]
)
async def test_failed_copy_aborts_and_preserves_staged_source(
    object_server: ObjectServer, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    staged, audio = prepare(object_server)
    object_server.fail = "wait" if failure in ("cancel", "timeout") else failure
    if failure == "timeout":
        monkeypatch.setattr(_promotion, "PROMOTION_TIMEOUT_SECONDS", 0.2)
    task = asyncio.create_task(
        storage_for(object_server).promote_staged(staged, audio, gated=False)
    )
    if failure in ("cancel", "timeout"):
        await asyncio.wait_for(object_server.waiting.wait(), 2)
    if failure == "cancel":
        task.cancel()
    with pytest.raises(
        (ClientError, ValueError, TimeoutError, asyncio.CancelledError)
    ) as error:
        await task
    if failure == "cancel":
        assert isinstance(error.value, asyncio.CancelledError)
    elif failure == "timeout":
        assert isinstance(error.value, TimeoutError)
    assert f"private/{staged.key}" in object_server.objects
    assert ("abort" in object_server.events) == (failure not in ("size", "etag"))
    assert not any(event.startswith("delete:") for event in object_server.events)
    if failure not in ("size", "etag"):
        assert object_server.parts == {}
        assert f"public/{audio.key}" not in object_server.objects


async def test_intermittent_heartbeat_failure_does_not_abort_real_copy(
    db_session: AsyncSession,
    object_server: ObjectServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    staged, audio = prepare(object_server)
    object_server.fail = "wait"
    upload_id = await job_service.create_job(
        JobType.UPLOAD, "did:test:fixture", "settling"
    )
    real_heartbeat = job_service.heartbeat
    calls = 0
    recovered = asyncio.Event()

    async def heartbeat(job_id: str) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ConnectionError("temporary database refusal")
        await real_heartbeat(job_id)
        recovered.set()

    monkeypatch.setattr(job_service, "heartbeat", heartbeat)
    monkeypatch.setattr(uploads, "PROMOTION_HEARTBEAT_SECONDS", 0.01)
    monkeypatch.setattr(uploads, "storage", storage_for(object_server))
    task = asyncio.create_task(
        uploads._promote_staged_audio(upload_id, staged, audio, gated=False)
    )
    try:
        await asyncio.wait_for(object_server.waiting.wait(), 2)
        await asyncio.wait_for(recovered.wait(), 2)
        assert not task.done()
        assert "abort" not in object_server.events
    finally:
        object_server.release.set()
        await task
    assert object_server.objects[f"public/{audio.key}"] == bytes(range(21))
    assert f"private/{staged.key}" not in object_server.objects
    stopped_calls = calls
    await asyncio.sleep(0.04)
    assert calls == stopped_calls
