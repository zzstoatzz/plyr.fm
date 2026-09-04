#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""the status-maintenance window report: what changed, where it landed, what was said.

prints markdown for the window since the last merged status-maintenance PR:

  1. backend releases (GitHub releases, timestamp tags) and the PRs each carried
  2. frontend promotes — Cloudflare Pages production deployments of `production-fe`,
     the only record a `just release-frontend-only` leaves
  3. every PR merged in the window with where it landed: a release tag, a promote
     time, or "staging only"
  4. public posts from the plyr.fm account, and from zzstoatzz.io where they
     mention plyr, via the public AppView (no auth)
  5. project scope: first commit, release count, the arcs in `.status_history/`,
     and STATUS.md's line count and archivable months

usage:
    uv run scripts/status_window.py                # window since the last maintenance merge
    uv run scripts/status_window.py --since 2026-08-26T00:00:00Z

credentials (optional; the promote section is skipped without them):
    CLOUDFLARE_API_TOKEN or SCRIPT_CF_API_TOKEN — Pages read on the account
    CLOUDFLARE_ACCOUNT_ID                        — defaults to the plyr.fm account
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

REPO = "zzstoatzz/plyr.fm"
PAGES_PROJECT = "plyr-fm"
PAGES_ACCOUNT = "3e9ba01cd687b3c4d29033908177072e"
PUBLIC_APPVIEW = "https://public.api.bsky.app/xrpc"
POST_ACCOUNTS = {"plyr.fm": None, "zzstoatzz.io": "plyr"}

BACKEND_PREFIXES = ("backend/", "scripts/", "services/", "pyproject.toml", "uv.lock")
FRONTEND_PREFIXES = ("frontend/",)
PR_REF = re.compile(r"\(#(\d+)\)")
ARC_HEADING = re.compile(r"^#{3,4} (.+)$", re.MULTILINE)
MONTH_ONLY = re.compile(
    r"^(early |late |mid[- ])?[A-Z][a-z]+ \d{4}( work)?( \(.*\))?$", re.IGNORECASE
)
ARC_TITLE_MONTHS = 3
MONTH_HEADING = re.compile(r"^### ([A-Z][a-z]+ \d{4})$", re.MULTILINE)


def sh(*args: str) -> str:
    return subprocess.run(
        args, capture_output=True, text=True, check=True
    ).stdout.strip()


def gh(*args: str) -> str:
    return sh("gh", *args, "-R", REPO)


def fetch_json(url: str, headers: dict[str, str] | None = None) -> dict:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def parse_time(raw: str) -> datetime:
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(UTC)


def fmt(when: datetime) -> str:
    return when.strftime("%Y-%m-%d %H:%MZ")


def last_maintenance_merge() -> tuple[int | None, datetime | None]:
    rows = json.loads(
        gh(
            "pr",
            "list",
            "--state",
            "merged",
            "--search",
            "status-maintenance",
            "--limit",
            "30",
            "--json",
            "number,mergedAt,headRefName",
        )
    )
    merged = [r for r in rows if r["headRefName"].startswith("status-maintenance-")]
    if not merged:
        return None, None
    latest = max(merged, key=lambda r: r["mergedAt"])
    return latest["number"], parse_time(latest["mergedAt"])


def merged_prs(since: datetime) -> list[dict]:
    rows = json.loads(
        gh(
            "pr",
            "list",
            "--state",
            "merged",
            "--search",
            f"merged:>={since.date().isoformat()}",
            "--limit",
            "300",
            "--json",
            "number,title,mergedAt,mergeCommit,files,url",
        )
    )
    rows = [r for r in rows if parse_time(r["mergedAt"]) >= since]
    return sorted(rows, key=lambda r: r["mergedAt"])


def classify(files: list[str]) -> str:
    if any(f.startswith(BACKEND_PREFIXES) for f in files):
        return "backend"
    if any(f.startswith(FRONTEND_PREFIXES) for f in files):
        return "frontend"
    return "docs"


def releases(since: datetime) -> list[dict]:
    rows = json.loads(
        gh("release", "list", "--limit", "40", "--json", "tagName,publishedAt")
    )
    rows = sorted(rows, key=lambda r: r["publishedAt"])
    out = []
    for previous, current in zip([None, *rows[:-1]], rows, strict=True):
        published = parse_time(current["publishedAt"])
        if published < since:
            continue
        span = (
            f"{previous['tagName']}..{current['tagName']}"
            if previous
            else current["tagName"]
        )
        subjects = sh("git", "log", "--format=%s", span).splitlines()
        prs = sorted({int(found[-1]) for s in subjects if (found := PR_REF.findall(s))})
        out.append({"tag": current["tagName"], "at": published, "prs": prs})
    return out


def first_tag_containing(sha: str) -> tuple[str, datetime] | None:
    tags = sh(
        "git",
        "tag",
        "--contains",
        sha,
        "--sort=creatordate",
        "--format=%(refname:short) %(creatordate:iso-strict)",
    ).splitlines()
    if not tags:
        return None
    tag, when = tags[0].split()
    return tag, parse_time(when)


def promotes(since: datetime) -> list[dict] | None:
    token = os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get(
        "SCRIPT_CF_API_TOKEN"
    )
    if not token:
        return None
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", PAGES_ACCOUNT)
    query = urllib.parse.urlencode({"env": "production", "per_page": 50})
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{PAGES_PROJECT}/deployments?{query}"
    try:
        body = fetch_json(url, {"Authorization": f"Bearer {token}"})
    except Exception as exc:
        print(f"<!-- pages deployments unavailable: {exc} -->", file=sys.stderr)
        return None
    out = []
    for d in body.get("result", []):
        meta = d.get("deployment_trigger", {}).get("metadata", {})
        if meta.get("branch") != "production-fe":
            continue
        created = parse_time(d["created_on"])
        if created < since:
            continue
        out.append(
            {
                "at": created,
                "sha": meta.get("commit_hash", ""),
                "status": d.get("latest_stage", {}).get("status"),
            }
        )
    return sorted(out, key=lambda p: p["at"])


def is_ancestor(sha: str, of: str) -> bool:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", sha, of], capture_output=True
    )
    return result.returncode == 0


def landed(pr: dict, promoted: list[dict] | None) -> str:
    sha = (pr.get("mergeCommit") or {}).get("oid")
    kind = classify([f["path"] for f in pr.get("files", [])])
    if kind == "docs":
        return "docs only"
    if not sha:
        return "unknown (no merge commit)"
    candidates: list[tuple[datetime, str]] = []
    if tagged := first_tag_containing(sha):
        candidates.append((tagged[1], f"prod via release {tagged[0]}"))
    if kind == "frontend":
        for p in promoted or []:
            if p["sha"] and is_ancestor(sha, p["sha"]):
                candidates.append(
                    (p["at"], f"prod via frontend promote {fmt(p['at'])}")
                )
                break
    if candidates:
        return min(candidates)[1]
    if kind == "frontend" and promoted is None:
        return "no release; frontend promote unknown (no Cloudflare token)"
    return "staging only"


def posts(since: datetime) -> list[dict]:
    out = []
    for handle, needle in POST_ACCOUNTS.items():
        query = urllib.parse.urlencode({"actor": handle, "limit": 100})
        try:
            feed = fetch_json(f"{PUBLIC_APPVIEW}/app.bsky.feed.getAuthorFeed?{query}")
        except Exception as exc:
            print(f"<!-- feed for {handle} unavailable: {exc} -->", file=sys.stderr)
            continue
        for item in feed.get("feed", []):
            post = item["post"]
            record = post.get("record", {})
            if "reason" in item or post["author"]["handle"] != handle:
                continue
            created = parse_time(record.get("createdAt", "1970-01-01T00:00:00Z"))
            if created < since:
                continue
            blob = json.dumps(record) + json.dumps(post.get("embed", {}))
            if needle and needle not in blob.lower():
                continue
            rkey = post["uri"].rsplit("/", 1)[-1]
            out.append(
                {
                    "at": created,
                    "handle": handle,
                    "reply": "reply" in record,
                    "text": record.get("text", "").replace("\n", " ").strip(),
                    "embed": post.get("embed", {})
                    .get("$type", "")
                    .split(".")[-1]
                    .replace("#view", ""),
                    "url": f"https://bsky.app/profile/{handle}/post/{rkey}",
                }
            )
    return sorted(out, key=lambda p: p["at"])


def project_scope(now: datetime) -> list[str]:
    lines = []
    first = sh("git", "log", "--reverse", "--format=%ad", "--date=short").splitlines()[
        0
    ]
    release_count = len(sh("git", "tag").splitlines())
    lines.append(f"- first commit {first}; {release_count} production releases to date")
    status = Path("STATUS.md").read_text()
    line_count = status.count("\n")
    current_month = now.strftime("%B %Y")
    archivable = [m for m in MONTH_HEADING.findall(status) if m != current_month]
    detailed = [
        m
        for m in archivable
        if "See `.status_history/" not in status.split(f"### {m}")[1].split("### ")[0]
    ]
    lines.append(
        f"- STATUS.md is {line_count} lines (ceiling 500); month sections still carrying detail: "
        + (", ".join(detailed) if detailed else "none")
    )
    lines.append(
        "- arcs already archived, by month (titles for the newest months; read the files for the rest):"
    )
    archives = sorted(Path(".status_history").glob("*.md"))
    for index, path in enumerate(archives):
        headings = [
            h for h in ARC_HEADING.findall(path.read_text()) if not MONTH_ONLY.match(h)
        ]
        lines.append(f"  - `{path.name}` — {len(headings)} arcs")
        if index >= len(archives) - ARC_TITLE_MONTHS:
            lines.extend(f"    - {h[:110]}" for h in headings)
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument(
        "--since", help="ISO time; default = last merged status-maintenance PR"
    )
    args = parser.parse_args()
    now = datetime.now(UTC)

    if args.since:
        since, source = parse_time(args.since), "given"
    else:
        number, merged_at = last_maintenance_merge()
        since = merged_at or datetime(2025, 10, 28, tzinfo=UTC)
        source = (
            f"status-maintenance PR #{number} merged"
            if number
            else "no maintenance PR found; project start"
        )

    print("# status window report")
    print(f"window: {fmt(since)} → {fmt(now)} ({source})")

    print("\n## backend releases in the window (production)")
    rel = releases(since)
    for r in rel:
        prs = ", ".join(f"#{n}" for n in r["prs"]) or "no PR-tagged commits"
        print(f"- `{r['tag']}` at {fmt(r['at'])} — {prs}")
    if not rel:
        print("- none")

    print("\n## frontend promotes in the window (`production-fe` on Cloudflare Pages)")
    promoted = promotes(since)
    if promoted is None:
        print("- unavailable: set CLOUDFLARE_API_TOKEN (or SCRIPT_CF_API_TOKEN)")
    elif not promoted:
        print("- none")
    for p in promoted or []:
        print(f"- {fmt(p['at'])} — `{p['sha'][:8]}` ({p['status']})")

    print("\n## PRs merged in the window and where they landed")
    prs = merged_prs(since)
    print("| PR | merged | title | landed |")
    print("|---|---|---|---|")
    for pr in prs:
        title = pr["title"].replace("|", "\\|")[:90]
        print(
            f"| [#{pr['number']}]({pr['url']}) | {fmt(parse_time(pr['mergedAt']))} | {title} | {landed(pr, promoted)} |"
        )
    if not prs:
        print("| — | — | none | — |")

    print("\n## public posts in the window")
    found = posts(since)
    for p in found:
        kind = "reply" if p["reply"] else "post"
        embed = f" [{p['embed']}]" if p["embed"] else ""
        print(
            f"- {fmt(p['at'])} @{p['handle']} ({kind}{embed}): {p['text'][:200]} — {p['url']}"
        )
    if not found:
        print("- none")

    print("\n## project scope")
    print("\n".join(project_scope(now)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
