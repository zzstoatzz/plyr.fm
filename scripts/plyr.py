#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "cyclopts>=3.0",
#     "httpx>=0.27",
#     "pydantic-settings>=2.0",
#     "rich>=13.0",
# ]
# ///
"""
plyr.fm CLI - upload and download tracks programmatically.

setup:
    1. create a developer token at plyr.fm/portal -> "your data" -> "developer tokens"
    2. export PLYR_TOKEN="your_token_here"

usage:
    uv run sandbox/plyr.py upload track.mp3 "My Track" --album "My Album"
    uv run sandbox/plyr.py download 42 -o my-track.mp3
    uv run sandbox/plyr.py list
    uv run sandbox/plyr.py delete 42
"""

import json
import sys
from pathlib import Path
from typing import Annotated

import httpx
from cyclopts import App, Parameter
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console
from rich.table import Table

console = Console()


class Settings(BaseSettings):
    """plyr.fm CLI configuration."""

    model_config = SettingsConfigDict(
        env_prefix="PLYR_", env_file=".env", extra="ignore"
    )

    token: str | None = Field(default=None, description="API token")
    api_url: str = Field(default="https://api.plyr.fm", description="API base URL")

    @property
    def headers(self) -> dict[str, str]:
        if not self.token:
            console.print("[red]error:[/] PLYR_TOKEN not set")
            console.print("create a token at plyr.fm/portal -> 'developer tokens'")
            sys.exit(1)
        return {"Authorization": f"Bearer {self.token}"}


settings = Settings()
app = App(help="plyr.fm CLI - upload and download tracks")


@app.command
def upload(
    file: Annotated[Path, Parameter(help="audio file to upload")],
    title: Annotated[str, Parameter(help="track title")],
    album: Annotated[str | None, Parameter(help="album name")] = None,
) -> None:
    """upload a track to plyr.fm."""
    if not file.exists():
        console.print(f"[red]error:[/] file not found: {file}")
        sys.exit(1)

    with console.status("uploading..."):
        with open(file, "rb") as f:
            files = {"file": (file.name, f)}
            data = {"title": title}
            if album:
                data["album"] = album

            response = httpx.post(
                f"{settings.api_url}/tracks/",
                headers=settings.headers,
                files=files,
                data=data,
                timeout=120.0,
            )

    if response.status_code == 401:
        console.print("[red]error:[/] invalid or expired token")
        sys.exit(1)

    if response.status_code == 403:
        detail = response.json().get("detail", "")
        if "artist_profile_required" in detail:
            console.print("[red]error:[/] create an artist profile first at plyr.fm")
        elif "scope_upgrade_required" in detail:
            console.print("[red]error:[/] log out and back in, then create a new token")
        else:
            console.print(f"[red]error:[/] forbidden - {detail}")
        sys.exit(1)

    response.raise_for_status()
    upload_data = response.json()
    upload_id = upload_data.get("upload_id")

    if not upload_id:
        console.print(f"[green]done:[/] {response.json()}")
        return

    # poll for completion
    console.print(f"processing: {upload_id}")
    with httpx.stream(
        "GET",
        f"{settings.api_url}/tracks/uploads/{upload_id}/progress",
        headers=settings.headers,
        timeout=300.0,
    ) as sse:
        for line in sse.iter_lines():
            if line.startswith("data: "):
                data = json.loads(line[6:])
                status = data.get("status")

                if status == "completed":
                    track_id = data.get("track_id")
                    console.print(f"[green]uploaded:[/] track {track_id}")
                    return
                elif status == "failed":
                    error = data.get("error", "unknown error")
                    console.print(f"[red]failed:[/] {error}")
                    sys.exit(1)


@app.command
def download(
    track_id: Annotated[int, Parameter(help="track ID to download")],
    output: Annotated[
        Path | None, Parameter(name=["--output", "-o"], help="output file")
    ] = None,
) -> None:
    """download a track from plyr.fm."""
    # get track info first
    with console.status("fetching track info..."):
        info_response = httpx.get(
            f"{settings.api_url}/tracks/{track_id}",
            headers=settings.headers,
            timeout=30.0,
        )

    if info_response.status_code == 404:
        console.print(f"[red]error:[/] track {track_id} not found")
        sys.exit(1)

    info_response.raise_for_status()
    track = info_response.json()

    # determine output filename
    if output is None:
        # use track title + extension from file_type
        ext = track.get("file_type", "mp3")
        safe_title = "".join(
            c if c.isalnum() or c in " -_" else "" for c in track["title"]
        )
        output = Path(f"{safe_title}.{ext}")

    # download audio
    with console.status(f"downloading {track['title']}..."):
        audio_response = httpx.get(
            f"{settings.api_url}/audio/{track['file_id']}",
            headers=settings.headers,
            follow_redirects=True,
            timeout=300.0,
        )

    audio_response.raise_for_status()

    output.write_bytes(audio_response.content)
    size_mb = len(audio_response.content) / 1024 / 1024
    console.print(f"[green]saved:[/] {output} ({size_mb:.1f} MB)")


@app.command(name="list")
def list_tracks(
    limit: Annotated[int, Parameter(help="max tracks to show")] = 20,
) -> None:
    """list your tracks."""
    with console.status("fetching tracks..."):
        response = httpx.get(
            f"{settings.api_url}/tracks/",
            headers=settings.headers,
            timeout=30.0,
        )

    response.raise_for_status()
    tracks = response.json().get("tracks", [])

    if not tracks:
        console.print("no tracks found")
        return

    table = Table(title="your tracks")
    table.add_column("ID", style="cyan")
    table.add_column("title")
    table.add_column("album")
    table.add_column("plays", justify="right")

    for track in tracks[:limit]:
        album = track.get("album")
        album_name = album.get("title") if isinstance(album, dict) else (album or "-")
        table.add_row(
            str(track["id"]),
            track["title"],
            album_name,
            str(track.get("play_count", 0)),
        )

    console.print(table)


@app.command
def delete(
    track_id: Annotated[int, Parameter(help="track ID to delete")],
    yes: Annotated[
        bool, Parameter(name=["--yes", "-y"], help="skip confirmation")
    ] = False,
) -> None:
    """delete a track."""
    # get track info first
    with console.status("fetching track info..."):
        info_response = httpx.get(
            f"{settings.api_url}/tracks/{track_id}",
            headers=settings.headers,
            timeout=30.0,
        )

    if info_response.status_code == 404:
        console.print(f"[red]error:[/] track {track_id} not found")
        sys.exit(1)

    info_response.raise_for_status()
    track = info_response.json()

    if not yes:
        console.print(f"delete '{track['title']}'? [y/N] ", end="")
        if input().lower() != "y":
            console.print("cancelled")
            return

    response = httpx.delete(
        f"{settings.api_url}/tracks/{track_id}",
        headers=settings.headers,
        timeout=30.0,
    )

    if response.status_code == 404:
        console.print(f"[red]error:[/] track {track_id} not found")
        sys.exit(1)

    response.raise_for_status()
    console.print(f"[green]deleted:[/] {track['title']}")


if __name__ == "__main__":
    app()
