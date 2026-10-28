# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx", "python-dotenv", "cryptography", "base58"]
# ///
"""Exercise protected PDS audio through staging and remove every test artifact.

uv run scripts/smoke_protected_audio.py --env-file /path/to/fixtures.env --execute

Requires AUTH_APP_PASSWORD_MINT_SECRET, ZAT_TEST_HANDLE/PASSWORD/PDS, and
NONSPACE_TEST_HANDLE/PASSWORD (or the existing PLYRFM_PASSWORD fixture).
Existing PLYR_PROTECTED_OWNER_TOKEN / PLYR_PROTECTED_READER_TOKEN may substitute
for API token minting; ZAT credentials remain necessary for owner PDS inspection.
Without --execute, no requests are sent. No values are printed.
"""

import argparse
import asyncio
import hashlib
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import base58
import httpx
from _protected_audio_scenarios import aif_optimization, missing_mirror
from _protected_audio_resumable import resumable_upload
from _protected_audio_smoke import (
    API,
    SmokeFixtures,
    audio,
    blob_cid,
    checked,
    headers,
    record_parts,
)
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from dotenv import load_dotenv


class Smoke(SmokeFixtures):
    async def wait_job(self, job_id: str, token: str) -> dict[str, Any]:
        async with self.http.stream(
            "GET",
            f"{self.api}/tracks/uploads/{job_id}/progress",
            headers=headers(token),
        ) as response:
            checked(response, 200, "job progress")
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line.removeprefix("data: "))
                if event.get("status") == "failed":
                    raise AssertionError(
                        "upload job failed; inspect its staging telemetry"
                    )
                if event.get("status") == "completed":
                    return event
        raise AssertionError("progress ended before terminal state")

    async def upload(
        self,
        token: str,
        body: bytes,
        accept: bool = False,
        *,
        filename: str = "smoke.wav",
        content_type: str = "audio/wav",
    ) -> dict[str, Any]:
        response = checked(
            await self.http.post(
                f"{self.api}/tracks/",
                headers=headers(token),
                data={
                    "title": f"protected smoke {self.stamp} {len(self.tracks)}",
                    "publishing": json.dumps(
                        {
                            "access": {
                                "listening": "public",
                                "downloads": "off",
                                "visibility": "unlisted",
                            }
                        }
                    ),
                    "tags": json.dumps(["integration-test", "protected-audio-smoke"]),
                    **({"accept_plyr_storage": "true"} if accept else {}),
                },
                files={"file": (filename, body, content_type)},
            ),
            200,
            "upload submission",
        )
        terminal = await self.wait_job(response.json()["upload_id"], token)
        track_id = int(terminal["track_id"])
        self.tracks[track_id] = token
        return checked(
            await self.http.get(
                f"{self.api}/tracks/{track_id}", headers=headers(token)
            ),
            200,
            "uploaded track",
        ).json()

    async def playback_and_downloads(self, track: dict[str, Any], token: str) -> None:
        file_id = track["file_id"]
        other = self.reader if token == self.owner else self.owner
        for listener in ("", other):
            auth = headers(listener) if listener else {}
            response = checked(
                await self.http.get(
                    f"{self.api}/audio/{file_id}",
                    headers={**auth, "Range": "bytes=0-31"},
                    follow_redirects=True,
                ),
                206,
                "public ranged playback",
            )
            assert len(response.content) == 32
            assert response.headers["content-range"].startswith("bytes 0-31/")
            assert not any(
                k.startswith("atproto-space") or k == "signature"
                for k in response.headers
            )
            for source_id in {file_id, track.get("original_file_id")} - {None}:
                refusal = await self.http.get(
                    f"{self.api}/audio/{source_id}/download", headers=auth
                )
                assert refusal.status_code in (401, 403), (
                    "downloads-off listener obtained an attachment"
                )
                if source_id != file_id:
                    denied = await self.http.get(
                        f"{self.api}/audio/{source_id}", headers=auth
                    )
                    assert denied.status_code in (401, 403)
            visible = checked(
                await self.http.get(f"{self.api}/tracks/{track['id']}", headers=auth),
                200,
                "public metadata",
            ).json()
            assert visible["downloadable"] is False
        head = checked(
            await self.http.head(f"{self.api}/audio/{file_id}"), 200, "playback HEAD"
        )
        assert not head.content
        owner_download = checked(
            await self.http.get(
                f"{self.api}/audio/{file_id}/download",
                headers=headers(token),
                follow_redirects=True,
            ),
            200,
            "owner source recovery",
        )
        assert owner_download.content
        self.passed("public playback and download boundaries", track_id=track["id"])

    async def inspect_spaces(self, track: dict[str, Any], original: bytes) -> str:
        public = (await self.pds_record(track["atproto_record_uri"]))["value"]
        assert "audioBlob" not in public, (
            "protected blob reference leaked into public repo"
        )
        source_uri = public["audioSpace"]
        self.sources.add(source_uri)
        parts = record_parts(source_uri)
        response = await self.http.get(
            f"{self.pds}/xrpc/com.atproto.space.getRecord",
            params=parts,
            headers=headers(self.pds_access),
        )
        if response.status_code == 404:
            latest = (await self.pds_record(track["atproto_record_uri"]))["value"]
            if latest["audioSpace"] == source_uri:
                raise AssertionError("published protected source record is missing")
            source_uri = latest["audioSpace"]
            self.sources.add(source_uri)
            parts = record_parts(source_uri)
            source = (await self.pds_record(source_uri))["value"]
        else:
            source = checked(response, 200, "protected source snapshot").json()["value"]
        policy = checked(
            await self.http.get(
                f"{self.pds}/xrpc/com.atproto.simplespace.getSpace",
                params={"space": parts["space"]},
                headers=headers(self.pds_access),
            ),
            200,
            "playback Space policies",
        ).json()
        assert policy["readPolicy"]["$type"].endswith("#publicPolicy")
        assert policy["writePolicy"]["$type"].endswith("#memberListPolicy")
        assert policy["appAccess"]["$type"].endswith("#allowList")
        assert len(policy["appAccess"]["allowed"]) == 1
        source_blob = source.get("originalAudioBlob") or source["audioBlob"]
        cid = blob_cid(source_blob)
        for protected_cid in {cid, blob_cid(source["audioBlob"])}:
            direct = await self.http.get(
                f"{self.pds}/xrpc/com.atproto.sync.getBlob",
                params={"did": parts["repo"], "cid": protected_cid},
            )
            assert direct.status_code in (400, 401, 403, 404), (
                "private blob exposed by public getBlob"
            )
        private = checked(
            await self.http.get(
                f"{self.pds}/xrpc/com.atproto.space.getBlob",
                params={"space": parts["space"], "repo": parts["repo"], "cid": cid},
                headers=headers(self.pds_access),
            ),
            200,
            "PDS source recovery",
        )
        assert (
            hashlib.sha256(private.content).digest()
            == hashlib.sha256(original).digest()
        )
        key = (
            ec.generate_private_key(ec.SECP256R1())
            .public_key()
            .public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.CompressedPoint
            )
        )
        kid = "did:key:z" + base58.b58encode(b"\x80\x24" + key).decode()
        refused = await self.http.post(
            f"{self.pds}/xrpc/com.atproto.space.getSpaceCredential",
            json={"space": parts["space"], "credentialKid": kid},
        )
        checked(refused, 403, "unattested app credential")
        assert refused.json()["error"] == "AppNotAuthorized"
        self.passed(
            "PDS ownership and app access", track_id=track["id"], source=source_uri
        )
        return source_uri

    async def revisions(self, track: dict[str, Any], initial: bytes) -> None:
        replaced = checked(
            await self.http.put(
                f"{self.api}/tracks/{track['id']}/audio",
                headers=headers(self.owner),
                files={"file": ("replacement.wav", audio(781), "audio/wav")},
            ),
            200,
            "replace submission",
        )
        await self.wait_job(replaced.json()["upload_id"], self.owner)
        current = checked(
            await self.http.get(
                f"{self.api}/tracks/{track['id']}", headers=headers(self.owner)
            ),
            200,
            "replacement track",
        ).json()
        assert current["file_id"] != track["file_id"]
        assert current["atproto_record_uri"] == track["atproto_record_uri"]
        await self.inspect_spaces(current, audio(781))
        await self.playback_and_downloads(current, self.owner)
        history = checked(
            await self.http.get(
                f"{self.api}/tracks/{track['id']}/revisions",
                headers=headers(self.owner),
            ),
            200,
            "revision history",
        ).json()["revisions"]
        assert len(history) == 1
        for method, path in [
            ("GET", f"/tracks/{track['id']}/revisions"),
            ("POST", f"/tracks/{track['id']}/revisions/{history[0]['id']}/restore"),
        ]:
            checked(
                await self.http.request(
                    method, self.api + path, headers=headers(self.reader)
                ),
                403,
                "non-owner revision access",
            )
        checked(
            await self.http.post(
                f"{self.api}/tracks/{track['id']}/revisions/{history[0]['id']}/restore",
                headers=headers(self.owner),
            ),
            200,
            "restore",
        )
        restored = checked(
            await self.http.get(
                f"{self.api}/tracks/{track['id']}", headers=headers(self.owner)
            ),
            200,
            "restored track",
        ).json()
        assert restored["file_id"] == track["file_id"]
        await self.inspect_spaces(restored, initial)
        await self.playback_and_downloads(restored, self.owner)
        self.passed(
            "replace, retained source, owner-only revisions, restore",
            track_id=track["id"],
        )

    async def index_echo(self, track: dict[str, Any], source_uri: str) -> None:
        current = await self.pds_record(track["atproto_record_uri"])
        parts = record_parts(track["atproto_record_uri"])
        title = f"protected indexed {self.stamp}"
        value = {**current["value"], "title": title}
        checked(
            await self.http.post(
                f"{self.pds}/xrpc/com.atproto.repo.putRecord",
                headers=headers(self.pds_access),
                json={**parts, "record": value, "swapRecord": current["cid"]},
            ),
            200,
            "direct PDS metadata edit",
        )
        for _ in range(90):
            response = await self.http.get(
                f"{self.api}/tracks/{track['id']}", headers=headers(self.owner)
            )
            if response.status_code == 200 and response.json()["title"] == title:
                indexed = response.json()
                assert indexed["file_id"] == track["file_id"]
                assert indexed["audio_storage"] == "r2_private"
                assert (await self.pds_record(indexed["atproto_record_uri"]))["value"][
                    "audioSpace"
                ] == source_uri
                await self.playback_and_downloads(indexed, self.owner)
                self.passed(
                    "Jetstream metadata echo retains protected source",
                    track_id=track["id"],
                )
                return
            await asyncio.sleep(1)
        raise AssertionError("direct PDS edit did not reach staging index")

    async def index_rebuild(self, track: dict[str, Any]) -> dict[str, Any]:
        public = (await self.pds_record(track["atproto_record_uri"]))["value"]
        parts = record_parts(track["atproto_record_uri"])
        cloned = checked(
            await self.http.post(
                f"{self.pds}/xrpc/com.atproto.repo.createRecord",
                headers=headers(self.pds_access),
                json={
                    "repo": parts["repo"],
                    "collection": parts["collection"],
                    "record": {**public, "title": f"protected rebuilt {self.stamp}"},
                },
            ),
            200,
            "direct PDS clone publication",
        ).json()
        self.public_records.add(cloned["uri"])
        for _ in range(90):
            response = await self.http.get(
                f"{self.api}/tracks/by-uri",
                params={"uri": cloned["uri"]},
                headers=headers(self.owner),
            )
            if response.status_code == 200:
                rebuilt = response.json()
                self.tracks[rebuilt["id"]] = self.owner
                assert rebuilt["file_id"] == track["file_id"]
                assert rebuilt["download_policy"] == "off"
                assert rebuilt["audio_storage"] == "r2_private"
                assert rebuilt["pds_blob_cid"] is None
                await self.playback_and_downloads(rebuilt, self.owner)
                self.passed(
                    "Jetstream creates protected index without upload reservation",
                    track_id=rebuilt["id"],
                )
                return rebuilt
            assert response.status_code == 404
            await asyncio.sleep(1)
        raise AssertionError("direct PDS fixture did not produce an indexed track")

    async def shared_delete(
        self, first: dict[str, Any], second: dict[str, Any], source_uri: str
    ) -> None:
        checked(
            await self.http.delete(
                f"{self.api}/tracks/{first['id']}", headers=headers(self.owner)
            ),
            200,
            "delete original shared-source fixture",
        )
        self.tracks.pop(first["id"])
        await self.pds_record(source_uri)
        await self.playback_and_downloads(second, self.owner)
        self.passed("deleting one track preserves a source another track owns")
        checked(
            await self.http.delete(
                f"{self.api}/tracks/{second['id']}", headers=headers(self.owner)
            ),
            200,
            "delete final shared-source fixture",
        )
        self.tracks.pop(second["id"])
        await self.pds_record(source_uri, 404)
        self.passed("deleting final track removes the shared protected source")

    async def fallback(self) -> None:
        body = audio(913)
        data = {
            "title": f"unaccepted storage {self.stamp}",
            "publishing": json.dumps(
                {
                    "access": {
                        "listening": "public",
                        "downloads": "off",
                        "visibility": "unlisted",
                    }
                }
            ),
            "tags": json.dumps(["integration-test"]),
        }
        rejected = await self.http.post(
            f"{self.api}/tracks/",
            headers=headers(self.reader),
            data=data,
            files={"file": ("fallback.wav", body, "audio/wav")},
        )
        assert rejected.status_code in (400, 409, 422), (
            "unsupported PDS silently accepted R2-only storage"
        )
        track = await self.upload(self.reader, body, accept=True)
        assert track["audio_storage"] == "r2_private"
        assert track["pds_blob_cid"] is None
        await self.playback_and_downloads(track, self.reader)
        self.passed(
            "non-Spaces R2 storage requires explicit acceptance", track_id=track["id"]
        )


async def run(args: argparse.Namespace) -> None:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(900, connect=30), follow_redirects=False
    ) as http:
        smoke = Smoke(http, args.api.rstrip("/"))
        success = False
        cleanup_success = False
        try:
            await smoke.setup()
            original = audio(time.time_ns() % 997)
            track = await smoke.upload(smoke.owner, original)
            assert track["visibility"] == "unlisted"
            source = await smoke.inspect_spaces(track, original)
            await smoke.playback_and_downloads(track, smoke.owner)
            await missing_mirror(smoke, track, original)
            rebuilt = await smoke.index_rebuild(track)
            await smoke.index_echo(track, source)
            await smoke.revisions(track, original)
            await smoke.shared_delete(track, rebuilt, source)
            await smoke.fallback()
            await resumable_upload(smoke)
            await aif_optimization(smoke)
            success = True
        finally:
            try:
                await smoke.cleanup()
                cleanup_success = True
            finally:
                if args.report:
                    Path(args.report).write_text(
                        json.dumps(
                            {
                                "passed": success and cleanup_success,
                                "checks": smoke.evidence,
                            },
                            indent=2,
                        )
                        + "\n"
                    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", action="append", default=[])
    parser.add_argument("--api", default=API)
    parser.add_argument("--report")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if urlparse(args.api).hostname != "api-stg.plyr.fm":
        parser.error("this harness only mutates api-stg.plyr.fm")
    for path in args.env_file:
        load_dotenv(path, override=False)
    if not args.execute:
        print("no requests sent; pass --execute after staging deployment")
        return
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
