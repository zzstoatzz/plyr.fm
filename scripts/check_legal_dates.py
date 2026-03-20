#!/usr/bin/env python3
"""pre-commit hook: ensure privacy policy date is updated when content changes."""

import re
import subprocess
import sys
from datetime import datetime

DATE_PATTERN = re.compile(r"Last updated:\s*(\w+ \d{1,2},\s*\d{4})")


def get_staged_content(path: str) -> str:
    result = subprocess.run(
        ["git", "show", f":{path}"],
        capture_output=True,
        text=True,
    )
    return result.stdout


def get_staged_diff(path: str) -> str:
    result = subprocess.run(
        ["git", "diff", "--cached", "--", path],
        capture_output=True,
        text=True,
    )
    return result.stdout


def check_file(path: str) -> bool:
    content = get_staged_content(path)
    if not content:
        return True

    match = DATE_PATTERN.search(content)
    if not match:
        print(f"  {path}: no 'Last updated' date found")
        return False

    date_str = match.group(1)
    try:
        doc_date = datetime.strptime(date_str, "%B %d, %Y")
    except ValueError:
        print(f"  {path}: could not parse date '{date_str}'")
        return False

    diff = get_staged_diff(path)
    diff_lines = diff.splitlines()

    # check if there are content changes beyond just the date line
    content_changed = False
    for line in diff_lines:
        if not line.startswith(("+", "-")):
            continue
        if line.startswith(("+++", "---")):
            continue
        if "Last updated:" in line:
            continue
        # ignore pure whitespace changes
        stripped = line[1:].strip()
        if stripped:
            content_changed = True
            break

    if not content_changed:
        return True

    now = datetime.now()
    if doc_date.year == now.year and doc_date.month == now.month:
        return True

    print(f"  {path}: privacy policy content changed — update the 'Last updated' date")
    print(f"  current: {date_str}, expected: current month ({now.strftime('%B %Y')})")
    return False


def main() -> int:
    files = sys.argv[1:]
    if not files:
        return 0

    ok = all(check_file(f) for f in files)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
