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

# hardcoded monthly costs (updated 2025-12-09)
# source: fly.io cost explorer, neon billing, cloudflare billing, audd dashboard
# NOTE: audd usage comes from their dashboard, not our database
# (copyright_scans table only has data since Nov 30, 2025)
FIXED_COSTS = {
    "fly_io": {
        "total": 28.83,
        "breakdown": {
            "relay-api": 5.80,  # prod backend
            "relay-api-staging": 5.60,
            "plyr-moderation": 0.24,
            "plyr-transcoder": 0.02,
            # non-plyr apps (included in org total but not plyr-specific)
            # "bsky-feed": 7.46,
            # "pds-zzstoatzz-io": 5.48,
            # "zzstoatzz-status": 3.48,
            # "at-me": 0.58,
            # "find-bufo": 0.13,
        },
        "note": "~40% of org total ($28.83) is plyr.fm",
    },
    "neon": {
        "total": 5.00,
        "note": "postgres serverless (3 projects: dev/stg/prd)",
    },
    "cloudflare": {
        "r2": 0.16,
        "pages": 0.00,
        "domain": 1.00,
        "total": 1.16,
        "note": "r2 egress is free, pages free tier",
    },
    # audd: ONE-TIME ADJUSTMENT for Nov 24 - Dec 24 billing period
    # the copyright_scans table was created Nov 24 but first scan recorded Nov 30
    # so we hardcode this period from AudD dashboard. DELETE THIS after Dec 24 -
    # future periods will use live database counts.
    # source: https://dashboard.audd.io - checked 2025-12-09
    "audd": {
        "total_requests": 6781,
        "included_requests": 6000,  # 1000 + 5000 bonus
        "billable_requests": 781,
        "cost_per_request": 0.005,  # $5 per 1000
        "cost": 3.91,  # 781 * $0.005
        "note": "copyright detection API (indie plan)",
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
    """fetch audd scan stats from postgres."""
    import asyncpg

    billing_start = get_billing_period_start()
    audd_config = FIXED_COSTS["audd"]

    # ONE-TIME: use hardcoded values for Nov 24 - Dec 24 billing period
    # remove this check after Dec 24, 2025
    use_hardcoded = billing_start.month == 11 and billing_start.day == 24

    conn = await asyncpg.connect(db_url)
    try:
        # get database stats
        row = await conn.fetchrow(
            """
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN is_flagged THEN 1 END) as flagged
            FROM copyright_scans
            WHERE scanned_at >= $1
            """,
            billing_start,
        )
        db_total = row["total"]
        db_flagged = row["flagged"]

        # daily breakdown for chart
        daily = await conn.fetch(
            """
            SELECT DATE(scanned_at) as date,
                   COUNT(*) as scans,
                   COUNT(CASE WHEN is_flagged THEN 1 END) as flagged
            FROM copyright_scans
            WHERE scanned_at >= $1
            GROUP BY DATE(scanned_at)
            ORDER BY date
            """,
            billing_start,
        )

        if use_hardcoded:
            # Nov 24 - Dec 24: use hardcoded values (incomplete db data)
            total = audd_config["total_requests"]
            included = audd_config["included_requests"]
            billable = audd_config["billable_requests"]
            cost = audd_config["cost"]
        else:
            # future billing periods: use live database counts
            total = db_total
            included = audd_config["included_requests"]
            billable = max(0, total - included)
            cost = round(billable * audd_config["cost_per_request"], 2)

        return {
            "billing_period_start": billing_start.isoformat(),
            "total_scans": total,
            "flagged": db_flagged,
            "flag_rate": round(db_flagged / db_total * 100, 1) if db_total else 0,
            "included_requests": included,
            "remaining_free": max(0, included - total),
            "billable_requests": billable,
            "estimated_cost": cost,
            "daily": [
                {
                    "date": r["date"].isoformat(),
                    "scans": r["scans"],
                    "flagged": r["flagged"],
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
                "note": "compute (2x shared-cpu VMs + moderation + transcoder)",
            },
            "neon": {
                "amount": FIXED_COSTS["neon"]["total"],
                "note": "postgres serverless",
            },
            "cloudflare": {
                "amount": FIXED_COSTS["cloudflare"]["total"],
                "breakdown": {
                    "r2_storage": FIXED_COSTS["cloudflare"]["r2"],
                    "pages": FIXED_COSTS["cloudflare"]["pages"],
                    "domain": FIXED_COSTS["cloudflare"]["domain"],
                },
                "note": "storage, hosting, domain",
            },
            "audd": {
                "amount": audd_stats["estimated_cost"],
                "scans_this_period": audd_stats["total_scans"],
                "included_free": audd_stats["included_requests"],
                "remaining_free": audd_stats["remaining_free"],
                "flag_rate": audd_stats["flag_rate"],
                "daily": audd_stats["daily"],
                "note": "copyright detection API",
            },
        },
        "support": {
            "kofi": "https://ko-fi.com/zzstoatzz",
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
