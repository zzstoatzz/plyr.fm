#!/usr/bin/env python3
"""create a github release using timestamp-based versioning (nebula strategy).

version format: YYYY.MMDD.HHMMSS (e.g., 2025.1106.134523)
"""

import subprocess
import sys
from datetime import UTC, datetime


def get_timestamp_version() -> str:
    """generate version string using nebula's timestamp strategy."""
    now = datetime.now(UTC)
    # format: YYYY.MMDD.HHMMSS
    return now.strftime("%Y.%m%d.%H%M%S")


def get_recent_commits(since_tag: str | None = None) -> list[str]:
    """get commit messages since last tag or all recent commits."""
    if since_tag:
        cmd = ["git", "log", f"{since_tag}..HEAD", "--oneline"]
    else:
        cmd = ["git", "log", "--oneline", "-20"]

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return [line for line in result.stdout.strip().split("\n") if line]


def get_latest_tag() -> str | None:
    """get the most recent git tag."""
    result = subprocess.run(
        ["git", "describe", "--tags", "--abbrev=0"],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def create_release(version: str, notes: str) -> None:
    """create github release using gh cli."""
    cmd = [
        "gh",
        "release",
        "create",
        version,
        "--title",
        version,
        "--notes",
        notes,
    ]

    subprocess.run(cmd, check=True)
    print(f"✓ created release {version}")
    print("✓ deployment to production will start automatically")


def main() -> int:
    """main entry point."""
    # ensure we're on main branch
    result = subprocess.run(
        ["git", "branch", "--show-current"],
        capture_output=True,
        text=True,
        check=True,
    )
    current_branch = result.stdout.strip()

    if current_branch != "main":
        print(f"error: must be on main branch (currently on {current_branch})")
        return 1

    # ensure working directory is clean
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    )
    if result.stdout.strip():
        print("error: working directory has uncommitted changes")
        return 1

    # generate version
    version = get_timestamp_version()
    print(f"version: {version}")

    # get commits since last tag
    latest_tag = get_latest_tag()
    commits = get_recent_commits(latest_tag)

    if not commits:
        print("warning: no commits since last release")

    # generate release notes
    notes_lines = []
    if latest_tag:
        notes_lines.append(f"changes since {latest_tag}:\n")
    else:
        notes_lines.append("initial production release\n")

    for commit in commits:
        notes_lines.append(f"- {commit}")

    notes = "\n".join(notes_lines)

    # show preview
    print("\nrelease notes:")
    print(notes)
    print()

    # confirm
    response = input(f"create release {version}? [y/N] ")
    if response.lower() != "y":
        print("cancelled")
        return 0

    # create release
    create_release(version, notes)

    return 0


if __name__ == "__main__":
    sys.exit(main())
