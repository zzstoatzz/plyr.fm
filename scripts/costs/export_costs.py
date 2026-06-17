#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["asyncpg", "boto3", "pydantic", "pydantic-settings", "typer"]
# ///
"""export platform costs to R2 for public dashboard

usage:
    uv run scripts/costs/export_costs.py              # export to R2 (prod)
    uv run scripts/costs/export_costs.py --dry-run    # print JSON, don't upload
    uv run scripts/costs/export_costs.py --env stg    # use staging db

AudD billing model:
    - $5/month base (indie plan)
    - 6000 free requests/month (1000 base + 5000 bonus)
    - $5 per 1000 requests after free tier
    - 1 request = 12 seconds of audio
    - so a 5-minute track = ceil(300/12) = 25 requests
"""

import asyncio
import json
import os
import re
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

import typer
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# AudD is the one cost we derive from our own usage (track durations in our DB),
# so it stays computed here. Everything else (fly/neon/cloudflare compute) is
# pulled live from the cost aggregator below — never hardcoded. see COSTS.md.
AUDD_BILLING_DAY = 24
AUDD_SECONDS_PER_REQUEST = 12
AUDD_FREE_REQUESTS = 6000  # 1000 base + 5000 bonus on indie plan
AUDD_COST_PER_1000 = 5.00  # $5 per 1000 requests
AUDD_BASE_COST = 5.00  # $5/month base

# live infra-cost feed (collected daily by my-prefect-server, surfaced at hub.waow.tech).
# line items tagged project=="plyr.fm" are this repo's infra. that mapping lives in
# my-prefect-server (packages/mps/src/mps/costs/projects.py), not here.
INFRA_COSTS_URL = "https://hub.waow.tech/api/costs.json"
PROJECT_KEY = "plyr.fm"
# feed provider -> the key the dashboard frontend expects
PROVIDER_KEYS = {"fly": "fly_io", "neon": "neon", "cloudflare": "cloudflare"}


def fetch_infra_costs() -> dict[str, Any]:
    """pull this repo's live infra costs (fly/neon/cloudflare) from the aggregator.

    returns one entry per provider with a total, a per-service breakdown, and a
    note carrying the service count. raises if the feed is unreachable or has no
    plyr.fm line items, so we never silently publish stale/empty data.
    """
    with urllib.request.urlopen(INFRA_COSTS_URL, timeout=15) as resp:
        feed = json.loads(resp.read())

    lines = [li for li in feed.get("lineItems", []) if li.get("project") == PROJECT_KEY]
    if not lines:
        raise RuntimeError(
            f"no '{PROJECT_KEY}' line items in {INFRA_COSTS_URL}; check the project mapping"
        )

    providers: dict[str, dict[str, Any]] = {}
    for li in lines:
        key = PROVIDER_KEYS.get(li["provider"])
        if key is None:
            continue  # provider not surfaced on the dashboard
        bucket = providers.setdefault(
            key, {"amount": 0.0, "breakdown": {}, "estimated": False, "services": []}
        )
        usd = li["amount"] / 100
        bucket["amount"] = round(bucket["amount"] + usd, 2)
        bucket["breakdown"][li["service"]] = round(usd, 2)
        bucket["estimated"] = bucket["estimated"] or bool(li.get("estimated"))
        bucket["services"].append(li["service"])

    for b in providers.values():
        n = len(b["services"])
        flag = " (estimated)" if b["estimated"] else ""
        b["note"] = f"{n} service(s) via hub.waow.tech{flag}"
        del b["services"]

    return {"generated_at": feed.get("generatedAt"), "providers": providers}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), extra="ignore")

    neon_database_url: str | None = None
    neon_database_url_prd: str | None = None
    neon_database_url_stg: str | None = None
    neon_database_url_dev: str | None = None

    # r2 stats bucket (dedicated, shared across environments)
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    r2_endpoint_url: str = ""
    r2_stats_bucket: str = Field(
        default="plyr-stats", validation_alias="R2_STATS_BUCKET"
    )
    r2_stats_public_url: str = Field(
        default="https://pub-68f2c7379f204d81bdf65152b0ff0207.r2.dev",
        validation_alias="R2_STATS_PUBLIC_URL",
    )

    def get_db_url(self, env: str) -> str:
        """get database url for environment, converting to asyncpg format"""
        url = getattr(self, f"neon_database_url_{env}", None) or self.neon_database_url
        if not url:
            raise ValueError(f"no database url for {env}")
        return re.sub(r"postgresql\+\w+://", "postgresql://", url)


settings = Settings()
app = typer.Typer(add_completion=False)


def get_billing_period_start() -> datetime:
    """get the start of current billing period (24th of month)"""
    now = datetime.now()
    if now.day >= AUDD_BILLING_DAY:
        return datetime(now.year, now.month, AUDD_BILLING_DAY)
    else:
        first_of_month = datetime(now.year, now.month, 1)
        prev_month = first_of_month - timedelta(days=1)
        return datetime(prev_month.year, prev_month.month, AUDD_BILLING_DAY)


async def get_audd_stats(db_url: str) -> dict[str, Any]:
    """fetch audd scan stats from postgres.

    calculates AudD API requests from track duration:
    - each 12 seconds of audio = 1 API request
    - derived by joining copyright_scans with tracks table
    """
    import asyncpg

    billing_start = get_billing_period_start()
    # 30 days of history for the daily chart (independent of billing cycle)
    history_start = datetime.now() - timedelta(days=30)

    conn = await asyncpg.connect(db_url)
    try:
        # get totals: scans, flagged, and derived API requests from duration
        # uses billing period for accurate cost calculation
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) as total_scans,
                COUNT(CASE WHEN cs.is_flagged THEN 1 END) as flagged,
                COALESCE(SUM(CEIL((t.extra->>'duration')::float / $2)), 0)::bigint as total_requests,
                COALESCE(SUM((t.extra->>'duration')::int), 0)::bigint as total_seconds
            FROM copyright_scans cs
            JOIN tracks t ON t.id = cs.track_id
            WHERE cs.scanned_at >= $1
            """,
            billing_start,
            AUDD_SECONDS_PER_REQUEST,
        )
        total_scans = row["total_scans"]
        flagged = row["flagged"]
        total_requests = row["total_requests"]
        total_seconds = row["total_seconds"]

        # daily breakdown for chart - 30 days of history for flexible views
        daily = await conn.fetch(
            """
            SELECT
                DATE(cs.scanned_at) as date,
                COUNT(*) as scans,
                COUNT(CASE WHEN cs.is_flagged THEN 1 END) as flagged,
                COALESCE(SUM(CEIL((t.extra->>'duration')::float / $2)), 0)::bigint as requests
            FROM copyright_scans cs
            JOIN tracks t ON t.id = cs.track_id
            WHERE cs.scanned_at >= $1
            GROUP BY DATE(cs.scanned_at)
            ORDER BY date
            """,
            history_start,
            AUDD_SECONDS_PER_REQUEST,
        )

        # calculate costs
        billable_requests = max(0, total_requests - AUDD_FREE_REQUESTS)
        overage_cost = round(billable_requests * AUDD_COST_PER_1000 / 1000, 2)
        total_cost = AUDD_BASE_COST + overage_cost

        return {
            "billing_period_start": billing_start.isoformat(),
            "total_scans": total_scans,
            "total_requests": total_requests,
            "total_audio_seconds": total_seconds,
            "flagged": flagged,
            "flag_rate": round(flagged / total_scans * 100, 1) if total_scans else 0,
            "free_requests": AUDD_FREE_REQUESTS,
            "remaining_free": max(0, AUDD_FREE_REQUESTS - total_requests),
            "billable_requests": billable_requests,
            "base_cost": AUDD_BASE_COST,
            "overage_cost": overage_cost,
            "estimated_cost": total_cost,
            "daily": [
                {
                    "date": r["date"].isoformat(),
                    "scans": r["scans"],
                    "flagged": r["flagged"],
                    "requests": r["requests"],
                }
                for r in daily
            ],
        }
    finally:
        await conn.close()


def build_cost_data(
    audd_stats: dict[str, Any], infra: dict[str, Any]
) -> dict[str, Any]:
    """assemble full cost dashboard data from live infra + computed AudD usage"""
    providers = infra["providers"]

    def provider(key: str) -> dict[str, Any]:
        # absent provider -> zeroed entry so the frontend always has the key
        return providers.get(
            key, {"amount": 0.0, "breakdown": {}, "note": "no plyr.fm line items"}
        )

    infra_total = sum(p["amount"] for p in providers.values())
    monthly_total = infra_total + audd_stats["estimated_cost"]

    return {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "infra_as_of": infra["generated_at"],
        "monthly_estimate": round(monthly_total, 2),
        "costs": {
            "fly_io": provider("fly_io"),
            "neon": provider("neon"),
            "cloudflare": provider("cloudflare"),
            "audd": {
                "amount": audd_stats["estimated_cost"],
                "base_cost": audd_stats["base_cost"],
                "overage_cost": audd_stats["overage_cost"],
                "scans_this_period": audd_stats["total_scans"],
                "requests_this_period": audd_stats["total_requests"],
                "audio_seconds": audd_stats["total_audio_seconds"],
                "free_requests": audd_stats["free_requests"],
                "remaining_free": audd_stats["remaining_free"],
                "billable_requests": audd_stats["billable_requests"],
                "flag_rate": audd_stats["flag_rate"],
                "daily": audd_stats["daily"],
                "note": f"copyright detection ($5 base + ${AUDD_COST_PER_1000}/1k requests over {AUDD_FREE_REQUESTS})",
            },
        },
        "support": {
            "url": "https://atprotofans.com/u/did:plc:xbtmt2zjwlrfegqvch7fboei",
            "message": "help cover moderation costs",
        },
    }


async def upload_to_r2(data: dict[str, Any]) -> str:
    """upload json to dedicated stats bucket"""
    import boto3

    bucket = settings.r2_stats_bucket
    key = "costs.json"
    body = json.dumps(data, indent=2).encode()

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=3600",
    )
    return f"{settings.r2_stats_public_url}/{key}"


@app.command()
def main(
    dry_run: bool = typer.Option(
        False, "--dry-run", "-n", help="print json, don't upload"
    ),
    env: str = typer.Option("prd", "--env", "-e", help="environment: prd, stg, dev"),
) -> None:
    """export platform costs to R2 for public dashboard"""
    if not os.environ.get("CI") and not dry_run:
        typer.echo("costs export should only run in CI (GitHub Actions)")
        typer.echo("  use --dry-run for local testing")
        raise typer.Exit(1)

    async def run():
        db_url = settings.get_db_url(env)
        audd_stats = await get_audd_stats(db_url)
        infra = await asyncio.to_thread(fetch_infra_costs)
        data = build_cost_data(audd_stats, infra)

        if dry_run:
            print(json.dumps(data, indent=2))
            return

        url = await upload_to_r2(data)
        print(f"uploaded to {url}")

    asyncio.run(run())


if __name__ == "__main__":
    app()
