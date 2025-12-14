#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "pydantic-ai>=0.1.0",
#     "anthropic",
#     "httpx",
#     "pydantic>=2.0",
#     "pydantic-settings",
#     "rich",
# ]
# ///
"""AI-powered moderation review agent for plyr.fm copyright flags.

this agent:
1. fetches all pending copyright flags from the moderation service
2. analyzes each flag using AI to categorize as likely violation or false positive
3. presents a summary for human review
4. bulk resolves flags with human approval

usage:
    uv run scripts/moderation_agent.py --env prod
    uv run scripts/moderation_agent.py --env prod --dry-run
    uv run scripts/moderation_agent.py --env staging --auto-resolve

environment variables:
    MODERATION_SERVICE_URL - URL of moderation service (default: https://plyr-moderation.fly.dev)
    MODERATION_AUTH_TOKEN - auth token for moderation service
    ANTHROPIC_API_KEY - API key for Claude
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from rich.table import Table

console = Console()


# --- settings ---


class AgentSettings(BaseSettings):
    """settings for moderation agent."""

    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent.parent / ".env",
        case_sensitive=False,
        extra="ignore",
    )

    moderation_service_url: str = Field(
        default="https://moderation.plyr.fm",
        validation_alias="MODERATION_SERVICE_URL",
    )
    moderation_auth_token: str = Field(
        default="", validation_alias="MODERATION_AUTH_TOKEN"
    )
    anthropic_api_key: str = Field(default="", validation_alias="ANTHROPIC_API_KEY")


# --- models ---


class CopyrightMatch(BaseModel):
    """a potential copyright match from AuDD."""

    title: str
    artist: str
    score: float


class LabelContext(BaseModel):
    """context stored with a copyright flag."""

    track_id: int | None = None
    track_title: str | None = None
    artist_handle: str | None = None
    artist_did: str | None = None
    highest_score: float | None = None
    matches: list[CopyrightMatch] | None = None
    resolution_reason: str | None = None
    resolution_notes: str | None = None


class FlaggedTrack(BaseModel):
    """a flagged track pending review."""

    seq: int
    uri: str
    val: str
    created_at: str
    resolved: bool
    context: LabelContext | None = None


class Category(str, Enum):
    """classification category for a flagged track."""

    LIKELY_VIOLATION = "likely_violation"
    LIKELY_FALSE_POSITIVE = "likely_false_positive"
    NEEDS_REVIEW = "needs_review"


class ResolutionReason(str, Enum):
    """reason for resolving a false positive."""

    ORIGINAL_ARTIST = "original_artist"
    LICENSED = "licensed"
    FINGERPRINT_NOISE = "fingerprint_noise"
    COVER_VERSION = "cover_version"
    OTHER = "other"


class FlagAnalysis(BaseModel):
    """AI analysis of a single flagged track."""

    category: Category
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    suggested_reason: ResolutionReason | None = None


class BatchAnalysis(BaseModel):
    """AI analysis of a batch of flagged tracks."""

    likely_violations: list[str] = Field(
        default_factory=list, description="URIs of tracks likely violating copyright"
    )
    likely_false_positives: list[str] = Field(
        default_factory=list, description="URIs of tracks likely false positives"
    )
    needs_review: list[str] = Field(
        default_factory=list, description="URIs needing human review"
    )
    summary: str = Field(description="brief summary of the analysis")
    per_track_analysis: dict[str, FlagAnalysis] = Field(
        default_factory=dict, description="detailed analysis per URI"
    )


# --- moderation service client ---


@dataclass
class ModerationClient:
    """client for the moderation service API."""

    base_url: str
    auth_token: str
    _client: httpx.AsyncClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-Moderation-Key": self.auth_token},
            timeout=30.0,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def list_flags(
        self, filter: Literal["pending", "resolved", "all"] = "pending"
    ) -> list[FlaggedTrack]:
        """list flagged tracks from the moderation service."""
        response = await self._client.get("/admin/flags", params={"filter": filter})
        response.raise_for_status()
        data = response.json()
        return [FlaggedTrack.model_validate(t) for t in data["tracks"]]

    async def resolve_flag(
        self,
        uri: str,
        reason: ResolutionReason,
        notes: str | None = None,
    ) -> dict:
        """resolve (negate) a copyright flag."""
        payload = {
            "uri": uri,
            "val": "copyright-violation",
            "reason": reason.value,
        }
        if notes:
            payload["notes"] = notes
        response = await self._client.post("/admin/resolve", json=payload)
        response.raise_for_status()
        return response.json()


# --- agent setup ---

SYSTEM_PROMPT = """\
you are a copyright moderation analyst for plyr.fm, a music streaming platform.

your task is to review flagged tracks and categorize them as:
- LIKELY_VIOLATION: high confidence this is actual copyright infringement
- LIKELY_FALSE_POSITIVE: high confidence this is NOT infringement (original artist, licensed, etc.)
- NEEDS_REVIEW: uncertain, requires human judgment

when analyzing flags, consider:

1. ORIGINAL ARTIST indicators (false positive):
   - artist handle matches or is similar to matched artist name
   - track title matches the uploaded track title
   - artist is likely uploading their own distributed music

2. FINGERPRINT NOISE indicators (false positive):
   - very low match scores (< 0.5)
   - generic/common samples or sounds
   - matched songs from different genres than uploaded track
   - one match among many unrelated matches

3. LICENSED/COVER indicators (false positive):
   - track explicitly labeled as cover, remix, or tribute
   - common phrases in titles suggesting original content

4. LIKELY VIOLATION indicators:
   - high match scores (> 0.8) with well-known commercial tracks
   - exact title matches with popular songs
   - matched artist is clearly different from uploader
   - multiple matches to same copyrighted work

be conservative: when in doubt, categorize as NEEDS_REVIEW rather than auto-resolving.
provide clear reasoning for each categorization.

for false positives, suggest the most appropriate resolution reason:
- original_artist: uploader is the matched artist
- licensed: uploader has rights to use the content
- fingerprint_noise: audio fingerprinting error
- cover_version: legal cover or remix
- other: doesn't fit other categories
"""


def create_agent(api_key: str) -> Agent[None, BatchAnalysis]:
    """create the moderation analysis agent."""
    from pydantic_ai.providers.anthropic import AnthropicProvider

    provider = AnthropicProvider(api_key=api_key)
    return Agent(
        model=AnthropicModel("claude-sonnet-4-20250514", provider=provider),
        output_type=BatchAnalysis,
        system_prompt=SYSTEM_PROMPT,
    )


# --- main logic ---


def format_track_for_analysis(track: FlaggedTrack) -> str:
    """format a track for inclusion in agent prompt."""
    ctx = track.context
    lines = [f"URI: {track.uri}"]

    if ctx:
        if ctx.track_title:
            lines.append(f"Uploaded Track: {ctx.track_title}")
        if ctx.artist_handle:
            lines.append(f"Uploader: @{ctx.artist_handle}")
        if ctx.matches:
            lines.append("Copyright Matches:")
            for m in ctx.matches[:5]:  # limit to top 5
                lines.append(f"  - '{m.title}' by {m.artist} (score: {m.score:.2f})")
    else:
        lines.append("(no context available)")

    return "\n".join(lines)


def truncate(s: str, max_len: int) -> str:
    """truncate string with ellipsis if needed."""
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def display_analysis_summary(
    analysis: BatchAnalysis,
    tracks: dict[str, FlaggedTrack],
) -> None:
    """display a rich summary of the analysis."""
    console.print()
    console.print(
        Panel(analysis.summary, title="analysis summary", border_style="blue")
    )

    # likely violations
    if analysis.likely_violations:
        table = Table(
            title="likely violations",
            border_style="red",
            show_lines=True,
            padding=(0, 1),
        )
        table.add_column("#", style="dim", width=3)
        table.add_column("track", style="red", max_width=25)
        table.add_column("matches", max_width=30)
        table.add_column("conf", width=5)
        table.add_column("reasoning", max_width=50)

        for i, uri in enumerate(analysis.likely_violations, 1):
            track = tracks.get(uri)
            info = analysis.per_track_analysis.get(uri)
            ctx = track.context if track else None

            title = truncate(ctx.track_title, 24) if ctx and ctx.track_title else "-"
            matches = (
                truncate(", ".join(f"{m.artist}" for m in ctx.matches[:2]), 29)
                if ctx and ctx.matches
                else "-"
            )
            conf = f"{info.confidence:.0%}" if info else "-"
            reasoning = truncate(info.reasoning, 49) if info else "-"

            table.add_row(str(i), title, matches, conf, reasoning)

        console.print(table)

    # likely false positives
    if analysis.likely_false_positives:
        table = Table(
            title="likely false positives",
            border_style="green",
            padding=(0, 1),
        )
        table.add_column("#", style="dim", width=3)
        table.add_column("track", style="green", max_width=30)
        table.add_column("artist", max_width=18)
        table.add_column("reason", width=18)
        table.add_column("conf", width=5)

        for i, uri in enumerate(analysis.likely_false_positives, 1):
            track = tracks.get(uri)
            info = analysis.per_track_analysis.get(uri)
            ctx = track.context if track else None

            title = truncate(ctx.track_title, 29) if ctx and ctx.track_title else "-"
            artist = (
                truncate(f"@{ctx.artist_handle}", 17)
                if ctx and ctx.artist_handle
                else "-"
            )
            reason = (
                info.suggested_reason.value if info and info.suggested_reason else "-"
            )
            conf = f"{info.confidence:.0%}" if info else "-"

            table.add_row(str(i), title, artist, reason, conf)

        console.print(table)

        # show full reasoning below
        console.print()
        console.print("[bold]reasoning:[/bold]")
        for i, uri in enumerate(analysis.likely_false_positives, 1):
            info = analysis.per_track_analysis.get(uri)
            if info:
                console.print(f"  [dim]{i}.[/dim] {info.reasoning}")

    # needs review
    if analysis.needs_review:
        table = Table(
            title="needs manual review",
            border_style="yellow",
            show_lines=True,
            padding=(0, 1),
        )
        table.add_column("#", style="dim", width=3)
        table.add_column("track", style="yellow", max_width=25)
        table.add_column("artist", max_width=15)
        table.add_column("matches", max_width=25)
        table.add_column("reasoning", max_width=50)

        for i, uri in enumerate(analysis.needs_review, 1):
            track = tracks.get(uri)
            info = analysis.per_track_analysis.get(uri)
            ctx = track.context if track else None

            title = truncate(ctx.track_title, 24) if ctx and ctx.track_title else "-"
            artist = (
                truncate(f"@{ctx.artist_handle}", 14)
                if ctx and ctx.artist_handle
                else "-"
            )
            matches = (
                truncate(", ".join(f"{m.artist}" for m in ctx.matches[:2]), 24)
                if ctx and ctx.matches
                else "-"
            )
            reasoning = truncate(info.reasoning, 49) if info else "-"

            table.add_row(str(i), title, artist, matches, reasoning)

        console.print(table)

    # summary stats
    console.print()
    console.print("[bold]totals:[/bold]")
    console.print(f"  likely violations: [red]{len(analysis.likely_violations)}[/red]")
    console.print(
        f"  likely false positives: [green]{len(analysis.likely_false_positives)}[/green]"
    )
    console.print(f"  needs review: [yellow]{len(analysis.needs_review)}[/yellow]")


async def run_agent(
    env: str,
    dry_run: bool = False,
    auto_resolve: bool = False,
    limit: int | None = None,
) -> None:
    """run the moderation agent."""
    settings = AgentSettings()

    if not settings.moderation_auth_token:
        console.print("[red]error: MODERATION_AUTH_TOKEN not set[/red]")
        return

    if not settings.anthropic_api_key:
        console.print("[red]error: ANTHROPIC_API_KEY not set[/red]")
        return

    console.print(f"[bold]moderation agent[/bold] - {env}")
    console.print(f"service: {settings.moderation_service_url}")
    console.print()

    # fetch pending flags
    client = ModerationClient(
        base_url=settings.moderation_service_url,
        auth_token=settings.moderation_auth_token,
    )

    try:
        console.print("[dim]fetching pending flags...[/dim]")
        flags = await client.list_flags(filter="pending")

        if not flags:
            console.print("[green]no pending flags[/green]")
            return

        if limit:
            flags = flags[:limit]
            console.print(f"[bold]found {len(flags)} pending flags (limited)[/bold]")
        else:
            console.print(f"[bold]found {len(flags)} pending flags[/bold]")

        # build analysis prompt
        tracks_by_uri = {f.uri: f for f in flags}
        track_descriptions = [format_track_for_analysis(f) for f in flags]

        # process in batches to avoid context limits
        batch_size = 20
        all_analyses: list[BatchAnalysis] = []
        agent = create_agent(settings.anthropic_api_key)

        for batch_start in range(0, len(flags), batch_size):
            batch_end = min(batch_start + batch_size, len(flags))
            batch_flags = flags[batch_start:batch_end]
            batch_descriptions = track_descriptions[batch_start:batch_end]

            console.print(
                f"[dim]analyzing batch {batch_start // batch_size + 1} "
                f"({batch_start + 1}-{batch_end} of {len(flags)})...[/dim]"
            )

            prompt = f"""\
analyze these {len(batch_flags)} flagged tracks and categorize EACH one.

IMPORTANT: You MUST include EVERY track URI in exactly one of these lists:
- likely_violations
- likely_false_positives
- needs_review

Also provide per_track_analysis with details for each URI.

---
{chr(10).join(f"### Track {i + 1}{chr(10)}{desc}{chr(10)}" for i, desc in enumerate(batch_descriptions))}
---

For each track:
1. Add its URI to the appropriate category list
2. Add an entry to per_track_analysis with the URI as key
3. Include confidence (0.0-1.0), reasoning, and suggested_reason for false positives
"""

            result = await agent.run(prompt)
            all_analyses.append(result.output)

        # merge all batch results
        analysis = BatchAnalysis(
            likely_violations=[],
            likely_false_positives=[],
            needs_review=[],
            summary="",
            per_track_analysis={},
        )
        for batch in all_analyses:
            analysis.likely_violations.extend(batch.likely_violations)
            analysis.likely_false_positives.extend(batch.likely_false_positives)
            analysis.needs_review.extend(batch.needs_review)
            analysis.per_track_analysis.update(batch.per_track_analysis)

        # generate summary
        analysis.summary = (
            f"analyzed {len(flags)} tracks: "
            f"{len(analysis.likely_violations)} likely violations, "
            f"{len(analysis.likely_false_positives)} likely false positives, "
            f"{len(analysis.needs_review)} need review"
        )

        # debug: show raw counts
        console.print(
            f"[dim]raw analysis: {len(analysis.likely_violations)} violations, "
            f"{len(analysis.likely_false_positives)} false positives, "
            f"{len(analysis.needs_review)} needs review[/dim]"
        )
        console.print(
            f"[dim]per_track_analysis entries: {len(analysis.per_track_analysis)}[/dim]"
        )

        # display results
        display_analysis_summary(analysis, tracks_by_uri)

        if dry_run:
            console.print("\n[yellow][DRY RUN] no changes made[/yellow]")
            return

        # handle false positives
        if analysis.likely_false_positives:
            console.print()

            if auto_resolve:
                proceed = True
                console.print(
                    "[yellow]auto-resolve enabled - proceeding without confirmation[/yellow]"
                )
            else:
                proceed = Confirm.ask(
                    f"resolve {len(analysis.likely_false_positives)} likely false positives?"
                )

            if proceed:
                resolved = 0
                for uri in analysis.likely_false_positives:
                    track_analysis = analysis.per_track_analysis.get(uri)
                    reason = (
                        track_analysis.suggested_reason
                        if track_analysis and track_analysis.suggested_reason
                        else ResolutionReason.OTHER
                    )
                    notes = (
                        f"AI analysis: {track_analysis.reasoning[:200]}"
                        if track_analysis
                        else "AI categorized as false positive"
                    )

                    try:
                        await client.resolve_flag(uri, reason, notes)
                        resolved += 1
                        console.print(
                            f"  [green]\u2713[/green] resolved: {uri[:60]}..."
                        )
                    except Exception as e:
                        console.print(
                            f"  [red]\u2717[/red] failed: {uri[:60]}... ({e})"
                        )

                console.print(f"\n[green]resolved {resolved} flags[/green]")

    finally:
        await client.close()


def main() -> None:
    """main entry point."""
    parser = argparse.ArgumentParser(description="AI moderation review agent")
    parser.add_argument(
        "--env",
        type=str,
        default="prod",
        choices=["dev", "staging", "prod"],
        help="environment (for display only)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="analyze flags without making changes",
    )
    parser.add_argument(
        "--auto-resolve",
        action="store_true",
        help="resolve false positives without confirmation",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="limit number of flags to process",
    )

    args = parser.parse_args()

    asyncio.run(run_agent(args.env, args.dry_run, args.auto_resolve, args.limit))


if __name__ == "__main__":
    main()
