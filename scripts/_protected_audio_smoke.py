"""Credential-safe fixtures and cleanup for the protected-audio staging smoke."""

import io
import json
import math
import os
import re
import secrets
import struct
import time
import wave
from dataclasses import dataclass, field
from typing import Any

import httpx

API = "https://api-stg.plyr.fm"
_FIXTURE_NONCE = secrets.token_hex(16).encode()


def with_nonce(body: bytes) -> bytes:
    if body.startswith(b"RIFF"):
        chunk, endian = b"JUNK", "<I"
    elif body.startswith(b"FORM"):
        chunk, endian = b"ANNO", ">I"
    else:
        raise ValueError("fixture must be a WAV or AIFF container")
    suffix = chunk + struct.pack(endian, len(_FIXTURE_NONCE)) + _FIXTURE_NONCE
    return (
        body[:4] + struct.pack(endian, len(body) + len(suffix) - 8) + body[8:] + suffix
    )


def audio(seed: int) -> bytes:
    data = io.BytesIO()
    with wave.open(data, "wb") as out:
        out.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        out.writeframes(
            b"".join(
                struct.pack("<h", int(1000 * math.sin((i + seed) / 13.1)))
                for i in range(16000)
            )
        )
    return with_nonce(data.getvalue())


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"missing {name}")
    return value


def maintenance_machine() -> str:
    machine = required("PLYR_SMOKE_MAINTENANCE_MACHINE")
    if not re.fullmatch(r"[0-9a-f]{14}", machine):
        raise ValueError("invalid staging maintenance machine ID")
    return machine


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def checked(response: httpx.Response, status: int, label: str) -> httpx.Response:
    if response.status_code != status:
        raise AssertionError(f"{label}: expected {status}, got {response.status_code}")
    return response


def record_parts(uri: str) -> dict[str, str]:
    parts = uri.removeprefix("at://").split("/")
    if len(parts) == 3:
        return dict(zip(("repo", "collection", "rkey"), parts, strict=True))
    if len(parts) == 7 and parts[1] == "space":
        return {
            "space": "at://" + "/".join(parts[:4]),
            "repo": parts[4],
            "collection": parts[5],
            "rkey": parts[6],
        }
    raise AssertionError("unexpected record URI shape")


def blob_cid(blob: dict[str, Any]) -> str:
    return blob["ref"]["$link"]


@dataclass
class SmokeFixtures:
    http: httpx.AsyncClient
    api: str
    owner: str = ""
    reader: str = ""
    pds_access: str = ""
    pds_refresh: str = ""
    pds_minted: bool = False
    pds: str = ""
    minted: list[str] = field(default_factory=list)
    tracks: dict[int, str] = field(default_factory=dict)
    sources: set[str] = field(default_factory=set)
    public_records: set[str] = field(default_factory=set)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    stamp: str = field(default_factory=lambda: str(time.time_ns()))

    def passed(self, name: str, **details: Any) -> None:
        evidence = {"check": name, **details}
        self.evidence.append(evidence)
        print(json.dumps(evidence), flush=True)

    async def mint(self, handle: str, password: str, pds: str | None = None) -> str:
        response = await self.http.post(
            f"{self.api}/auth/dev-token/app-password",
            headers={"x-admin-token": required("AUTH_APP_PASSWORD_MINT_SECRET")},
            json={
                "identifier": handle,
                "app_password": password,
                "pds_url": pds,
                "name": "protected-audio-staging-smoke",
            },
        )
        token = checked(response, 200, "mint fixture token").json()["token"]
        self.minted.append(token)
        return token

    async def setup(self) -> None:
        self.pds = required("ZAT_TEST_PDS").rstrip("/")
        self.owner = os.getenv("PLYR_PROTECTED_OWNER_TOKEN", "") or await self.mint(
            required("ZAT_TEST_HANDLE"), required("ZAT_TEST_PASSWORD"), self.pds
        )
        reader_handle = os.getenv("NONSPACE_TEST_HANDLE", "plyr.fm")
        reader_password = os.getenv("NONSPACE_TEST_PASSWORD") or os.getenv(
            "PLYRFM_PASSWORD"
        )
        self.reader = os.getenv("PLYR_PROTECTED_READER_TOKEN", "")
        if not self.reader:
            if not reader_password:
                raise ValueError("missing NONSPACE_TEST_PASSWORD or PLYRFM_PASSWORD")
            self.reader = await self.mint(reader_handle, reader_password)
        for token, expected in [(self.owner, True), (self.reader, False)]:
            me = checked(
                await self.http.get(f"{self.api}/auth/me", headers=headers(token)),
                200,
                "fixture identity",
            ).json()
            if me.get("permissioned_spaces", {}).get("supported") is not expected:
                raise AssertionError(
                    "fixture PDS capability differs from intended lane"
                )
        self.pds_access = os.getenv("PLYR_PROTECTED_PDS_ACCESS_TOKEN", "")
        if not self.pds_access:
            login = checked(
                await self.http.post(
                    f"{self.pds}/xrpc/com.atproto.server.createSession",
                    json={
                        "identifier": required("ZAT_TEST_HANDLE"),
                        "password": required("ZAT_TEST_PASSWORD"),
                    },
                ),
                200,
                "owner PDS session",
            ).json()
            self.pds_access = login["accessJwt"]
            self.pds_refresh = login["refreshJwt"]
            self.pds_minted = True
        self.passed("fixtures", owner_spaces=True, reader_spaces=False)

    async def pds_record(self, uri: str, expected: int = 200) -> dict[str, Any]:
        parts = record_parts(uri)
        method = (
            "com.atproto.space.getRecord"
            if "space" in parts
            else "com.atproto.repo.getRecord"
        )
        response = checked(
            await self.http.get(
                f"{self.pds}/xrpc/{method}",
                params=parts,
                headers=headers(self.pds_access),
            ),
            expected,
            "owner source record",
        )
        return response.json() if expected == 200 else {}

    async def cleanup(self) -> None:
        failures: list[str] = []
        for track_id, token in self.tracks.items():
            try:
                response = await self.http.delete(
                    f"{self.api}/tracks/{track_id}", headers=headers(token), timeout=45
                )
                if response.status_code not in (200, 204, 404):
                    failures.append(f"track {track_id}: {response.status_code}")
            except httpx.HTTPError:
                failures.append(f"track {track_id}: cleanup request failed")
        for uri in sorted(self.public_records):
            try:
                response = await self.http.post(
                    f"{self.pds}/xrpc/com.atproto.repo.deleteRecord",
                    headers=headers(self.pds_access),
                    json=record_parts(uri),
                    timeout=45,
                )
                if response.status_code not in (200, 400, 404):
                    failures.append("direct fixture public record cleanup failed")
            except httpx.HTTPError:
                failures.append("direct fixture public record cleanup request failed")
        for uri in sorted(self.sources):
            try:
                await self.pds_record(uri, 404)
            except (AssertionError, httpx.HTTPError):
                failures.append("protected source retained after track deletion")
                try:
                    await self.http.post(
                        f"{self.pds}/xrpc/com.atproto.space.deleteRecord",
                        headers=headers(self.pds_access),
                        json=record_parts(uri),
                        timeout=45,
                    )
                except httpx.HTTPError:
                    failures.append("protected source cleanup request failed")
        for token in self.minted:
            try:
                response = await self.http.delete(
                    f"{self.api}/auth/developer-tokens/{token[:8]}",
                    headers=headers(token),
                    timeout=45,
                )
                if response.status_code not in (200, 204, 404):
                    failures.append("fixture API token revoke failed")
            except httpx.HTTPError:
                failures.append("fixture API token revoke request failed")
        if self.pds_minted:
            try:
                response = await self.http.post(
                    f"{self.pds}/xrpc/com.atproto.server.deleteSession",
                    headers=headers(self.pds_refresh),
                    timeout=45,
                )
                self.passed(
                    "owner PDS session teardown response", status=response.status_code
                )
            except httpx.HTTPError:
                failures.append("PDS session teardown request failed")
        if failures:
            raise AssertionError("cleanup failed: " + "; ".join(failures))
        self.passed("fixture tracks, source records and temporary API tokens cleaned")
