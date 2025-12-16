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
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import typer
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# billing constants
AUDD_BILLING_DAY = 24
AUDD_SECONDS_PER_REQUEST = 12
AUDD_FREE_REQUESTS = 6000  # 1000 base + 5000 bonus on indie plan
AUDD_COST_PER_1000 = 5.00  # $5 per 1000 requests
AUDD_BASE_COST = 5.00  # $5/month base

# fixed monthly costs (updated 2025-12-16)
# fly.io: manually updated from cost explorer (TODO: use fly billing API)
# neon: fixed $5/month
# cloudflare: mostly free tier
FIXED_COSTS = {
    "fly_io": {
        "breakdown": {
            "relay-api": 5.80,  # prod backend
            "relay-api-staging": 5.60,
            "plyr-moderation": 0.24,
            "plyr-transcoder": 0.02,
        },
        "note": "compute (2x shared-cpu VMs + moderation + transcoder)",
    },
    "neon": {
        "total": 5.00,
        "note": "postgres serverless (fixed)",
    },
    "cloudflare": {
        "r2": 0.16,
        "pages": 0.00,
        "domain": 1.00,
        "total": 1.16,
        "note": "r2 egress is free, pages free tier",
    },
}


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

    conn = await asyncpg.connect(db_url)
    try:
        # get totals: scans, flagged, and derived API requests from duration
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

        # daily breakdown for chart - now includes requests derived from duration
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
            billing_start,
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


def build_cost_data(audd_stats: dict[str, Any]) -> dict[str, Any]:
    """assemble full cost dashboard data"""
    # calculate plyr-specific fly costs
    plyr_fly = sum(FIXED_COSTS["fly_io"]["breakdown"].values())

    monthly_total = (
        plyr_fly
        + FIXED_COSTS["neon"]["total"]
        + FIXED_COSTS["cloudflare"]["total"]
        + audd_stats["estimated_cost"]
    )

    return {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "monthly_estimate": round(monthly_total, 2),
        "costs": {
            "fly_io": {
                "amount": round(plyr_fly, 2),
                "breakdown": FIXED_COSTS["fly_io"]["breakdown"],
                "note": FIXED_COSTS["fly_io"]["note"],
            },
            "neon": {
                "amount": FIXED_COSTS["neon"]["total"],
                "note": FIXED_COSTS["neon"]["note"],
            },
            "cloudflare": {
                "amount": FIXED_COSTS["cloudflare"]["total"],
                "breakdown": {
                    "r2_storage": FIXED_COSTS["cloudflare"]["r2"],
                    "pages": FIXED_COSTS["cloudflare"]["pages"],
                    "domain": FIXED_COSTS["cloudflare"]["domain"],
                },
                "note": FIXED_COSTS["cloudflare"]["note"],
            },
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

    async def run():
        db_url = settings.get_db_url(env)
        audd_stats = await get_audd_stats(db_url)
        data = build_cost_data(audd_stats)

        if dry_run:
            print(json.dumps(data, indent=2))
            return

        url = await upload_to_r2(data)
        print(f"uploaded to {url}")

    asyncio.run(run())


if __name__ == "__main__":
    app()
