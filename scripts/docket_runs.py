#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["redis"]
# ///
"""check recent docket task runs.

usage:
    ./scripts/docket_runs.py                    # uses DOCKET_URL from env
    ./scripts/docket_runs.py --env staging      # uses staging redis
    ./scripts/docket_runs.py --env production   # uses production redis
    ./scripts/docket_runs.py --limit 20         # show more runs
"""

import argparse
import os

import redis


def main():
    parser = argparse.ArgumentParser(description="check docket task runs")
    parser.add_argument(
        "--env",
        choices=["local", "staging", "production"],
        default="local",
        help="environment to check (default: local, uses DOCKET_URL)",
    )
    parser.add_argument(
        "--limit", type=int, default=10, help="number of runs to show (default: 10)"
    )
    args = parser.parse_args()

    # get redis url
    if args.env == "local":
        url = os.environ.get("DOCKET_URL", "redis://localhost:6379")
    elif args.env == "staging":
        url = os.environ.get("DOCKET_URL_STAGING")
        if not url:
            print("error: DOCKET_URL_STAGING not set")
            print(
                "hint: export DOCKET_URL_STAGING=rediss://default:xxx@xxx.upstash.io:6379"
            )
            return 1
    elif args.env == "production":
        url = os.environ.get("DOCKET_URL_PRODUCTION")
        if not url:
            print("error: DOCKET_URL_PRODUCTION not set")
            print(
                "hint: export DOCKET_URL_PRODUCTION=rediss://default:xxx@xxx.upstash.io:6379"
            )
            return 1

    print(f"connecting to {args.env}...")
    r = redis.from_url(url)

    # get all run keys
    keys = r.keys("plyr:runs:*")
    if not keys:
        print("no runs found")
        return 0

    print(f"found {len(keys)} total runs, showing last {args.limit}:\n")

    for key in sorted(keys, reverse=True)[: args.limit]:
        data = r.hgetall(key)
        run_id = key.decode().split(":")[-1]

        # extract fields safely
        function = data.get(b"function", b"?").decode()
        state = data.get(b"state", b"?").decode()
        started = (
            data.get(b"started_at", b"").decode()[:19]
            if data.get(b"started_at")
            else "?"
        )
        completed = (
            data.get(b"completed_at", b"").decode()[:19]
            if data.get(b"completed_at")
            else "-"
        )
        # state emoji
        emoji = {"completed": "✓", "failed": "✗", "running": "⋯"}.get(state, "?")

        print(
            f"{emoji} {run_id[:8]}  {function:<20} {state:<10} {started} → {completed}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
