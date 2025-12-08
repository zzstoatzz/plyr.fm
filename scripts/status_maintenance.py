#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "agentic-learning>=0.4.0",
#     "anthropic>=0.40.0",
#     "pydantic-settings>=2.0.0",
# ]
# [tool.uv]
# prerelease = "allow"
# ///
"""letta-backed status maintenance for plyr.fm.

this script replaces the claude-code-action in the status maintenance workflow.
it uses letta's learning SDK to maintain persistent memory across runs.

the memory is about PROJECT UNDERSTANDING (architecture, patterns, context),
NOT about processing history. github is the source of truth for what needs
processing (last merged PR date → now).

usage:
    # full maintenance run (archive, generate script, create audio)
    uv run scripts/status_maintenance.py

    # skip audio generation
    uv run scripts/status_maintenance.py --skip-audio

    # dry run (no file changes)
    uv run scripts/status_maintenance.py --dry-run

environment variables:
    LETTA_API_KEY - letta cloud API key
    ANTHROPIC_API_KEY - anthropic API key
    GOOGLE_API_KEY - gemini TTS (for audio generation)
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

AGENT_NAME = "plyr-status-maintenance"
# memory blocks are about PROJECT UNDERSTANDING, not processing history
# the agent should remember architecture, patterns, and context - NOT what it processed
MEMORY_BLOCKS = [
    "project_architecture",  # how plyr.fm is built, key design decisions
    "atproto_context",  # understanding of ATProto, lexicons, NSIDs
    "recurring_patterns",  # themes that come up repeatedly in development
]
PROJECT_ROOT = Path(__file__).parent.parent


class Settings(BaseSettings):
    """settings for status maintenance."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        case_sensitive=False,
        extra="ignore",
    )

    letta_api_key: str = Field(validation_alias="LETTA_API_KEY")
    anthropic_api_key: str = Field(validation_alias="ANTHROPIC_API_KEY")
    google_api_key: str = Field(default="", validation_alias="GOOGLE_API_KEY")
    model: str = Field(
        default="claude-opus-4-5-20251101", validation_alias="ANTHROPIC_MODEL"
    )


class MaintenanceReport(BaseModel):
    """structured output for status maintenance report."""

    archive_needed: bool = Field(
        description="true if STATUS.md > 400 lines and old content should be archived"
    )
    archive_content: str = Field(
        description="content to move to .status_history/YYYY-MM.md (verbatim, oldest sections). empty string if no archival needed."
    )
    status_updates: str = Field(
        description="new content to add to the '## recent work' section of STATUS.md"
    )
    podcast_script: str = Field(
        description="2-3 minute podcast script with 'Host:' and 'Cohost:' lines following the tone and structure guidelines"
    )


def run_cmd(cmd: list[str], capture: bool = True) -> str:
    """run a command and return output."""
    result = subprocess.run(cmd, capture_output=capture, text=True, cwd=PROJECT_ROOT)
    return result.stdout.strip() if capture else ""


def get_last_maintenance_date() -> str | None:
    """get the merge date of the last status-maintenance PR.

    this is the SOURCE OF TRUTH for what time window to process.
    NOT the agent's memory - github is authoritative.
    """
    try:
        result = run_cmd(
            [
                "gh",
                "pr",
                "list",
                "--state",
                "merged",
                "--search",
                "status-maintenance",
                "--limit",
                "20",
                "--json",
                "number,title,mergedAt,headRefName",
            ]
        )
        if not result:
            return None

        prs = json.loads(result)
        # filter to status-maintenance branches and sort by merge date
        maintenance_prs = [
            pr
            for pr in prs
            if pr.get("headRefName", "").startswith("status-maintenance-")
        ]
        if not maintenance_prs:
            return None

        # sort by mergedAt descending
        maintenance_prs.sort(key=lambda x: x.get("mergedAt", ""), reverse=True)
        return maintenance_prs[0].get("mergedAt", "").split("T")[0]
    except Exception:
        return None


def get_recent_commits(since: str | None = None, limit: int = 50) -> str:
    """get recent commits, optionally since a date."""
    cmd = ["git", "log", "--oneline", f"-{limit}"]
    if since:
        cmd.extend(["--since", since])
    return run_cmd(cmd)


def get_merged_prs(since: str | None = None, limit: int = 30) -> str:
    """get merged PRs with details."""
    search = f"merged:>={since}" if since else ""
    cmd = [
        "gh",
        "pr",
        "list",
        "--state",
        "merged",
        "--limit",
        str(limit),
        "--json",
        "number,title,body,mergedAt,additions,deletions",
    ]
    if search:
        cmd.extend(["--search", search])
    return run_cmd(cmd)


def get_status_md_line_count() -> int:
    """get current line count of STATUS.md."""
    status_file = PROJECT_ROOT / "STATUS.md"
    if status_file.exists():
        return len(status_file.read_text().splitlines())
    return 0


def read_status_md() -> str:
    """read current STATUS.md content."""
    status_file = PROJECT_ROOT / "STATUS.md"
    if status_file.exists():
        return status_file.read_text()
    return ""


def check_status_history_exists() -> bool:
    """check if .status_history/ directory exists (implies not first episode)."""
    return (PROJECT_ROOT / ".status_history").exists()


def generate_maintenance_report(
    settings: Settings,
    last_maintenance: str | None,
    dry_run: bool = False,
) -> MaintenanceReport:
    """generate the maintenance report using letta-backed claude with structured outputs.

    uses anthropic's structured outputs beta for guaranteed schema compliance.
    """
    # SDK's capture() reads from os.environ
    os.environ["LETTA_API_KEY"] = settings.letta_api_key

    import anthropic
    from agentic_learning import AgenticLearning, learning

    # initialize clients
    letta_client = AgenticLearning(api_key=settings.letta_api_key)
    anthropic_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # ensure agent exists
    existing = letta_client.agents.retrieve(agent=AGENT_NAME)
    if not existing:
        print(f"creating letta agent '{AGENT_NAME}'...")
        letta_client.agents.create(
            agent=AGENT_NAME,
            memory=MEMORY_BLOCKS,
            model=f"anthropic/{settings.model}",
        )
        print(f"✓ agent created with memory blocks: {MEMORY_BLOCKS}")

    # gather context - read the FULL STATUS.md, not truncated
    today = datetime.now().strftime("%Y-%m-%d")
    today_human = datetime.now().strftime("%B %d, %Y")
    commits = get_recent_commits(since=last_maintenance)
    prs = get_merged_prs(since=last_maintenance)
    status_content = read_status_md()
    line_count = get_status_md_line_count()
    has_history = check_status_history_exists()
    is_first_episode = not has_history

    if last_maintenance:
        time_window = f"since {last_maintenance}"
        time_window_human = f"from {last_maintenance} to {today}"
    else:
        time_window = "all time (first run)"
        time_window_human = f"up to {today}"

    system_prompt = f"""you maintain STATUS.md for plyr.fm (pronounced "player FM"), a decentralized
music streaming platform on AT Protocol.

## memory usage

your letta memory persists across runs. remember:
- architecture and design decisions
- ATProto concepts (lexicons, NSIDs, PDS)
- recurring development patterns

do NOT track what you processed - github determines the time window.

## rules

- STATUS.md must stay under 500 lines
- archive old content to .status_history/, never delete
- podcast tone: dry, matter-of-fact, sardonic - never enthusiastic

## context

today: {today_human}
last maintenance PR: {last_maintenance or "none (first run)"}
time window: {time_window_human}
STATUS.md lines: {line_count}
first episode: {is_first_episode}

focus on what shipped {time_window}. if last PR merged Dec 2nd and today is Dec 8th,
cover Dec 3rd onwards - not "the last week".

## commits ({time_window}):
{commits}

## merged PRs ({time_window}):
{prs}

## STATUS.md:
{status_content}

## tasks

1. **archival**: if > 400 lines, move oldest sections to .status_history/YYYY-MM.md (by month)
2. **status_updates**: new content for "## recent work" - concise, technical, what shipped and why
3. **podcast_script**: "Host:" and "Cohost:" dialogue, 2-3 min (4-5 min if first episode)

## podcast requirements

**pronunciation**: ALWAYS write "player FM" - never "plyr.fm" or "plyr" (TTS will mispronounce it)

**time references**: use specific dates ("since December 2nd"), never "last week" or "recently"

**structure**: tell a coherent story
- opening: set the date range and focus
- main story: biggest thing that shipped, design discussion between hosts
- secondary: other significant changes (lighter treatment)
- rapid fire: bug fixes, polish, minor improvements
- closing: wrap up

**tone**: two engineers who are skeptical, amused by the absurdity of building things.
acknowledge limitations honestly. explain through analogy, not jargon.
avoid: "exciting", "amazing", "incredible", "great job", any over-congratulating.

**what shipped**: read commits/PRs carefully. new things "shipped", improvements are "fixes" or "polish".
don't trust commit prefixes - read the actual content.
"""

    print(f"generating maintenance report for {time_window}...")

    with learning(agent=AGENT_NAME, client=letta_client, memory=MEMORY_BLOCKS):
        # use structured outputs beta for guaranteed schema compliance
        response = anthropic_client.beta.messages.parse(
            model=settings.model,
            max_tokens=8192,
            betas=["structured-outputs-2025-11-13"],
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"""analyze what shipped {time_window} and generate the maintenance report.

remember key architectural insights and patterns for future runs - but do NOT
remember "what you processed" since github is the source of truth for that.""",
                }
            ],
            output_format=MaintenanceReport,
        )

    # structured outputs gives us the parsed model directly
    report = response.parsed_output

    print("✓ report generated")
    print(f"  archive needed: {report.archive_needed}")
    print(f"  status updates: {len(report.status_updates)} chars")
    print(f"  podcast script: {len(report.podcast_script)} chars")

    return report


def apply_maintenance(report: MaintenanceReport, dry_run: bool = False) -> list[str]:
    """apply the maintenance report to files.

    returns list of modified files.
    """
    modified_files = []

    # handle archival
    if report.archive_needed and report.archive_content:
        archive_dir = PROJECT_ROOT / ".status_history"
        archive_file = archive_dir / f"{datetime.now().strftime('%Y-%m')}.md"

        if dry_run:
            print(f"[dry-run] would archive to {archive_file}")
        else:
            archive_dir.mkdir(exist_ok=True)
            # append to existing month file or create new
            mode = "a" if archive_file.exists() else "w"
            with open(archive_file, mode) as f:
                if mode == "a":
                    f.write("\n\n---\n\n")
                f.write(report.archive_content)
            modified_files.append(str(archive_file))
            print(f"✓ archived content to {archive_file}")

    # update STATUS.md
    if report.status_updates:
        status_file = PROJECT_ROOT / "STATUS.md"
        if dry_run:
            print(f"[dry-run] would update {status_file}")
        else:
            # read current content
            current = status_file.read_text() if status_file.exists() else ""

            # find "## recent work" section and insert after it
            if "## recent work" in current:
                parts = current.split("## recent work", 1)
                # find the next section or end
                after_header = parts[1]
                # insert new content after the header line
                lines = after_header.split("\n", 1)
                new_content = (
                    parts[0]
                    + "## recent work"
                    + lines[0]
                    + "\n\n"
                    + report.status_updates
                    + "\n"
                    + (lines[1] if len(lines) > 1 else "")
                )
                status_file.write_text(new_content)
            else:
                # no recent work section, append to end
                with open(status_file, "a") as f:
                    f.write(f"\n## recent work\n\n{report.status_updates}\n")

            modified_files.append(str(status_file))
            print(f"✓ updated {status_file}")

    # write podcast script
    if report.podcast_script:
        script_file = PROJECT_ROOT / "podcast_script.txt"
        if dry_run:
            print(f"[dry-run] would write {script_file}")
        else:
            script_file.write_text(report.podcast_script)
            modified_files.append(str(script_file))
            print(f"✓ wrote podcast script to {script_file}")

    return modified_files


def generate_audio(settings: Settings, dry_run: bool = False) -> str | None:
    """generate audio from podcast script.

    returns path to audio file or None.
    """
    script_file = PROJECT_ROOT / "podcast_script.txt"
    audio_file = PROJECT_ROOT / "update.wav"

    if not script_file.exists():
        print("no podcast script found, skipping audio generation")
        return None

    if not settings.google_api_key:
        print("GOOGLE_API_KEY not set, skipping audio generation")
        return None

    if dry_run:
        print(f"[dry-run] would generate audio: {audio_file}")
        return None

    print("generating audio...")
    result = subprocess.run(
        ["uv", "run", "scripts/generate_tts.py", str(script_file), str(audio_file)],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
        env={**os.environ, "GOOGLE_API_KEY": settings.google_api_key},
    )

    if result.returncode != 0:
        print(f"audio generation failed: {result.stderr}")
        return None

    # cleanup script file
    script_file.unlink()
    print(f"✓ generated {audio_file}")
    return str(audio_file)


def main() -> None:
    """main entry point."""
    parser = argparse.ArgumentParser(description="letta-backed status maintenance")
    parser.add_argument(
        "--skip-audio", action="store_true", help="skip audio generation"
    )
    parser.add_argument("--dry-run", action="store_true", help="don't modify files")
    args = parser.parse_args()

    print("=" * 60)
    print("plyr.fm status maintenance (letta-backed)")
    print("=" * 60)

    # load settings
    try:
        settings = Settings()
    except Exception as e:
        print(f"error loading settings: {e}")
        print("\nrequired environment variables:")
        print("  LETTA_API_KEY")
        print("  ANTHROPIC_API_KEY")
        print("  GOOGLE_API_KEY (optional, for audio)")
        sys.exit(1)

    # determine time window from GITHUB (source of truth), not agent memory
    last_maintenance = get_last_maintenance_date()
    if last_maintenance:
        print(f"last maintenance PR merged: {last_maintenance}")
    else:
        print("no previous maintenance PR found - first run")

    # generate report
    report = generate_maintenance_report(settings, last_maintenance, args.dry_run)

    # apply changes
    modified_files = apply_maintenance(report, args.dry_run)

    # generate audio
    if not args.skip_audio:
        audio_file = generate_audio(settings, args.dry_run)
        if audio_file:
            modified_files.append(audio_file)

    print("\n" + "=" * 60)
    if args.dry_run:
        print("[dry-run] no files modified")
    elif modified_files:
        print(f"modified files: {len(modified_files)}")
        for f in modified_files:
            print(f"  - {f}")
    else:
        print("no changes needed")

    # output for CI
    if modified_files and not args.dry_run:
        # write modified files list for CI
        with open(PROJECT_ROOT / ".modified_files", "w") as f:
            f.write("\n".join(modified_files))


if __name__ == "__main__":
    main()
