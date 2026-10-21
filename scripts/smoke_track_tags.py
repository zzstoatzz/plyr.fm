"""Exercise API and direct-PDS tags against staging, then remove test tracks."""

import asyncio
import io
import json
import math
import os
import struct
import time
import wave
from datetime import UTC, datetime
from typing import Any

import httpx

API = "https://api-stg.plyr.fm"


def audio(frequency: int) -> bytes:
    data = io.BytesIO()
    with wave.open(data, "wb") as output:
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        output.writeframes(
            b"".join(
                struct.pack(
                    "<h", int(1000 * math.sin(2 * math.pi * frequency * i / 16000))
                )
                for i in range(16000)
            )
        )
    return data.getvalue()


async def main() -> None:
    token = os.environ["PLYR_TEST_TOKEN_1"]
    pds = os.environ["PLYR_TEST_PDS_URL"].rstrip("/")
    did = os.environ["PLYR_TEST_DID"]
    access = os.environ["PLYR_TEST_PDS_ACCESS_TOKEN"]
    ids: set[int] = set()
    records: list[tuple[str, str]] = []
    stamp = str(time.time_ns())
    async with (
        httpx.AsyncClient(
            timeout=180, headers={"Authorization": f"Bearer {token}"}
        ) as api,
        httpx.AsyncClient(
            timeout=45, headers={"Authorization": f"Bearer {access}"}
        ) as repo,
    ):

        async def xrpc(method: str, name: str, body: dict[str, Any]) -> dict[str, Any]:
            response = await repo.request(
                method,
                f"{pds}/xrpc/{name}",
                **({"params": body} if method == "GET" else {"json": body}),
            )
            response.raise_for_status()
            return response.json() if response.content else {}

        async def record(collection: str, rkey: str) -> dict[str, Any]:
            return await xrpc(
                "GET",
                "com.atproto.repo.getRecord",
                {"repo": did, "collection": collection, "rkey": rkey},
            )

        async def put(
            collection: str, rkey: str, value: dict[str, Any]
        ) -> dict[str, Any]:
            current = await record(collection, rkey)
            return await xrpc(
                "POST",
                "com.atproto.repo.putRecord",
                {
                    "repo": did,
                    "collection": collection,
                    "rkey": rkey,
                    "record": value,
                    "swapRecord": current["cid"],
                },
            )

        async def indexed(
            uri: str, expected: set[str], title: str | None = None
        ) -> dict[str, Any]:
            for _ in range(90):
                response = await api.get(f"{API}/tracks/by-uri", params={"uri": uri})
                if response.status_code == 200:
                    track = response.json()
                    ids.add(track["id"])
                    if set(track["tags"]) == expected and (
                        title is None or track["title"] == title
                    ):
                        return track
                elif response.status_code != 404:
                    response.raise_for_status()
                await asyncio.sleep(1)
            raise AssertionError(f"index did not converge for {uri}: {response.text}")

        async def edit(track_id: int, fields: dict[str, str]) -> None:
            response = await api.patch(f"{API}/tracks/{track_id}", data=fields)
            response.raise_for_status()

        try:
            response = await api.post(
                f"{API}/tracks/",
                files={"file": ("tags.wav", audio(401), "audio/wav")},
                data={
                    "title": f"tag smoke API {stamp}",
                    "tags": '["integration-test", "ambient"]',
                    "publishing": json.dumps(
                        {
                            "access": {
                                "visibility": "unlisted",
                                "listening": "public",
                                "downloads": "open",
                            }
                        }
                    ),
                },
            )
            response.raise_for_status()
            upload_id = response.json()["upload_id"]
            track_id: int | None = None
            async with api.stream(
                "GET", f"{API}/tracks/uploads/{upload_id}/progress"
            ) as stream:
                stream.raise_for_status()
                async for line in stream.aiter_lines():
                    if line.startswith("data: "):
                        event = json.loads(line[6:])
                        if event.get("status") == "failed":
                            raise AssertionError(event)
                        if event.get("status") == "completed":
                            track_id = event["track_id"]
                            ids.add(track_id)
                            break
            assert track_id is not None
            response = await api.get(f"{API}/tracks/{track_id}")
            response.raise_for_status()
            track = response.json()
            uri = track["atproto_record_uri"]
            collection, rkey = uri.split("/")[-2:]
            assert collection == "fm.plyr.stg.track", collection
            assert set((await record(collection, rkey))["value"]["tags"]) == {
                "integration-test",
                "ambient",
            }
            await edit(track_id, {"tags": '["integration-test", "ai"]'})
            assert set((await record(collection, rkey))["value"]["tags"]) == {
                "integration-test",
                "ai",
            }
            await edit(track_id, {"tags": "[]"})
            assert (await record(collection, rkey))["value"]["tags"] == []
            await indexed(uri, set())
            print(
                json.dumps(
                    {
                        "case": "API upload, tag-only edit, explicit clear",
                        "track_id": track_id,
                        "ok": True,
                    }
                ),
                flush=True,
            )

            for tagged in (True, False):
                blob_response = await repo.post(
                    f"{pds}/xrpc/com.atproto.repo.uploadBlob",
                    content=audio(409 if tagged else 419),
                    headers={"Content-Type": "audio/wav"},
                )
                blob_response.raise_for_status()
                value: dict[str, Any] = {
                    "$type": collection,
                    "title": f"tag smoke direct {stamp} {tagged}",
                    "artist": "plyr.fm",
                    "fileType": "wav",
                    "audioBlob": blob_response.json()["blob"],
                    "createdAt": datetime.now(UTC).isoformat(),
                    "example.extension": {"preserve": True},
                }
                if tagged:
                    value["tags"] = ["integration-test", "ai"]
                created = await xrpc(
                    "POST",
                    "com.atproto.repo.createRecord",
                    {"repo": did, "collection": collection, "record": value},
                )
                direct_uri = created["uri"]
                direct_key = direct_uri.rsplit("/", 1)[1]
                records.append((collection, direct_key))
                direct = await indexed(direct_uri, set(value.get("tags", [])))
                value["title"] += " external edit"
                value["tags"] = ["integration-test", "ambient"]
                await put(collection, direct_key, value)
                await edit(direct["id"], {"tags": '["integration-test", "ai"]'})
                fresh = (await record(collection, direct_key))["value"]
                assert fresh["title"] == value["title"]
                assert fresh["example.extension"] == {"preserve": True}
                await indexed(
                    direct_uri, {"integration-test", "ai"}, title=value["title"]
                )
                value = fresh
                value["tags"] = []
                await put(collection, direct_key, value)
                await indexed(direct_uri, set())
                value["tags"] = ["integration-test", "ambient"]
                await put(collection, direct_key, value)
                await indexed(direct_uri, {"integration-test", "ambient"})
                del value["tags"]
                await put(collection, direct_key, value)
                await indexed(direct_uri, set())
                stale = await record(collection, direct_key)
                value["tags"] = ["integration-test", "ai"]
                await put(collection, direct_key, value)
                conflict = await repo.post(
                    f"{pds}/xrpc/com.atproto.repo.putRecord",
                    json={
                        "repo": did,
                        "collection": collection,
                        "rkey": direct_key,
                        "record": stale["value"],
                        "swapRecord": stale["cid"],
                    },
                )
                assert (
                    conflict.status_code == 400
                    and conflict.json()["error"] == "InvalidSwap"
                ), conflict.text
                await indexed(direct_uri, {"integration-test", "ai"})
                print(
                    json.dumps(
                        {
                            "case": "direct PDS create, external edit, API preservation, empty/absent clear, stale CID",
                            "track_id": direct["id"],
                            "ok": True,
                        }
                    ),
                    flush=True,
                )
        finally:
            for identifier in ids:
                response = await api.delete(f"{API}/tracks/{identifier}")
                if response.status_code not in (200, 204, 404):
                    raise RuntimeError(
                        f"cleanup failed for track {identifier}: {response.status_code}"
                    )
            for collection, rkey in records:
                response = await repo.post(
                    f"{pds}/xrpc/com.atproto.repo.deleteRecord",
                    json={"repo": did, "collection": collection, "rkey": rkey},
                )
                response.raise_for_status()
            print(json.dumps({"cleanup": sorted(ids)}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
