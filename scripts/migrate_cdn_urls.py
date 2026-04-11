#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = ["asyncpg", "rich", "typer"]
# ///
"""migrate R2 URLs from r2.dev to custom CDN domains.

## context

R2 buckets were originally exposed via r2.dev managed subdomains, which
bypass Cloudflare's CDN cache layer entirely. custom domains
(audio.plyr.fm, images.plyr.fm) were provisioned to enable edge caching.

this script updates the cached URLs in the database so the API serves
CDN-backed URLs instead of direct R2 URLs. the underlying R2 objects
don't move — both URLs resolve to the same bytes.

## what it updates

- tracks.r2_url (audio CDN URLs)
- tracks.image_url (image CDN URLs)
- tracks.thumbnail_url (thumbnail CDN URLs)
- albums.image_url
- albums.thumbnail_url
- playlists.image_url
- playlists.thumbnail_url

## usage

    # dry run — show what would change
    uv run scripts/migrate_cdn_urls.py

    # apply changes
    uv run scripts/migrate_cdn_urls.py --apply

    # target a specific database
    DATABASE_URL=postgresql://... uv run scripts/migrate_cdn_urls.py --apply
"""

import asyncio
import os

import asyncpg
import typer
from rich.console import Console
from rich.table import Table

console = Console()


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        typer.echo("DATABASE_URL not set", err=True)
        raise typer.Exit(1)
    return url


async def _run(
    old_audio: str,
    new_audio: str,
    old_images: str,
    new_images: str,
    apply: bool,
) -> None:
    conn = await asyncpg.connect(_get_database_url())

    table = Table(title="CDN URL migration" + (" (dry run)" if not apply else ""))
    table.add_column("table.column")
    table.add_column("rows")
    table.add_column("old domain")
    table.add_column("new domain")

    updates = [
        ("tracks", "r2_url", old_audio, new_audio),
        ("tracks", "image_url", old_images, new_images),
        ("tracks", "thumbnail_url", old_images, new_images),
        ("albums", "image_url", old_images, new_images),
        ("albums", "thumbnail_url", old_images, new_images),
        ("playlists", "image_url", old_images, new_images),
        ("playlists", "thumbnail_url", old_images, new_images),
    ]

    total = 0
    for tbl, col, old, new in updates:
        count = await conn.fetchval(
            f"SELECT COUNT(*) FROM {tbl} WHERE {col} LIKE $1",
            f"%{old}%",
        )
        if count > 0:
            table.add_row(f"{tbl}.{col}", str(count), old, new)
            total += count

            if apply:
                await conn.execute(
                    f"UPDATE {tbl} SET {col} = replace({col}, $1, $2) WHERE {col} LIKE $3",
                    old,
                    new,
                    f"%{old}%",
                )

    console.print(table)
    console.print(
        f"\ntotal: {total} rows" + (" updated" if apply else " would be updated")
    )

    if not apply and total > 0:
        console.print("\nrun with --apply to execute", style="dim")

    await conn.close()


def main(
    apply: bool = typer.Option(False, help="apply changes (default is dry run)"),
    old_audio: str = typer.Option(
        "",
        help="r2.dev audio domain to replace (auto-detected from DATABASE_URL if empty)",
    ),
    new_audio: str = typer.Option(
        "",
        help="custom audio domain (auto-detected from DATABASE_URL if empty)",
    ),
    old_images: str = typer.Option(
        "",
        help="r2.dev images domain to replace (auto-detected from DATABASE_URL if empty)",
    ),
    new_images: str = typer.Option(
        "",
        help="custom images domain (auto-detected from DATABASE_URL if empty)",
    ),
) -> None:
    """migrate R2 URLs from r2.dev to custom CDN domains."""
    db_url = _get_database_url()

    # auto-detect environment from DATABASE_URL
    if not all([old_audio, new_audio, old_images, new_images]):
        if "plyr-prd" in db_url or "cold-butterfly" in db_url:
            old_audio = (
                old_audio or "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev"
            )
            new_audio = new_audio or "https://audio.plyr.fm"
            old_images = (
                old_images or "https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev"
            )
            new_images = new_images or "https://images.plyr.fm"
            console.print("detected: [bold]production[/bold]")
        elif "plyr-stg" in db_url or "frosty-math" in db_url:
            old_audio = (
                old_audio or "https://pub-0a0a2e70496c461581c9fafb442b269d.r2.dev"
            )
            new_audio = new_audio or "https://audio-stg.plyr.fm"
            old_images = (
                old_images or "https://pub-6991ec380502409380d5b3c3aa28230c.r2.dev"
            )
            new_images = new_images or "https://images-stg.plyr.fm"
            console.print("detected: [bold]staging[/bold]")
        else:
            console.print(
                "could not detect environment from DATABASE_URL. "
                "pass --old-audio, --new-audio, --old-images, --new-images explicitly.",
                style="red",
            )
            raise typer.Exit(1)

    asyncio.run(_run(old_audio, new_audio, old_images, new_images, apply))


if __name__ == "__main__":
    typer.run(main)
