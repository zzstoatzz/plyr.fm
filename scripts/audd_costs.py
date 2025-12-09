#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["asyncpg", "rich", "plotext", "typer", "pydantic-settings"]
# ///
"""audd api cost tracker - because $0.005 adds up

usage:
    uv run scripts/audd_costs.py              # current billing period (prod)
    uv run scripts/audd_costs.py --all        # all time stats

set NEON_DATABASE_URL in .env (or NEON_DATABASE_URL_PRD, _STG, _DEV)
"""

import asyncio
import re
from datetime import datetime, timedelta
from typing import Any

import plotext as plt
import typer
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# audd indie plan pricing
INCLUDED_REQUESTS = 6000  # 1000 + 5000 bonus
COST_PER_REQUEST = 0.005  # $5 per 1000
BILLING_DAY = 24  # payment expected on the 24th


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    neon_database_url: str | None = None
    neon_database_url_prd: str | None = None
    neon_database_url_stg: str | None = None
    neon_database_url_dev: str | None = None

    def get_url(self, env: str) -> str:
        """get database url for environment, converting to asyncpg format"""
        url = getattr(self, f"neon_database_url_{env}", None) or self.neon_database_url
        if not url:
            raise ValueError(
                f"no database url for {env} - set NEON_DATABASE_URL or NEON_DATABASE_URL_{env.upper()}"
            )
        # convert sqlalchemy dialect to plain postgres
        return re.sub(r"postgresql\+\w+://", "postgresql://", url)


settings = Settings()

console = Console()
app = typer.Typer(add_completion=False)


def get_billing_period_start() -> datetime:
    """get the start of current billing period (24th of month)"""
    now = datetime.now()
    if now.day >= BILLING_DAY:
        return datetime(now.year, now.month, BILLING_DAY)
    else:
        first_of_month = datetime(now.year, now.month, 1)
        prev_month = first_of_month - timedelta(days=1)
        return datetime(prev_month.year, prev_month.month, BILLING_DAY)


async def query_scans(
    db_url: str, since: datetime | None = None
) -> list[dict[str, Any]]:
    """fetch scan data from postgres"""
    import asyncpg

    conn = await asyncpg.connect(db_url)
    try:
        if since:
            rows = await conn.fetch(
                """
                SELECT DATE(scanned_at) as date,
                       COUNT(*) as scans,
                       COUNT(CASE WHEN is_flagged THEN 1 END) as flagged
                FROM copyright_scans
                WHERE scanned_at >= $1
                GROUP BY DATE(scanned_at)
                ORDER BY date
                """,
                since,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT DATE(scanned_at) as date,
                       COUNT(*) as scans,
                       COUNT(CASE WHEN is_flagged THEN 1 END) as flagged
                FROM copyright_scans
                GROUP BY DATE(scanned_at)
                ORDER BY date
                """
            )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def get_totals(db_url: str, since: datetime | None = None) -> dict[str, int]:
    """get total counts"""
    import asyncpg

    conn = await asyncpg.connect(db_url)
    try:
        if since:
            row = await conn.fetchrow(
                """
                SELECT COUNT(*) as total,
                       COUNT(CASE WHEN is_flagged THEN 1 END) as flagged
                FROM copyright_scans
                WHERE scanned_at >= $1
                """,
                since,
            )
        else:
            row = await conn.fetchrow(
                """
                SELECT COUNT(*) as total,
                       COUNT(CASE WHEN is_flagged THEN 1 END) as flagged
                FROM copyright_scans
                """
            )
        return {"total": row["total"], "flagged": row["flagged"]}
    finally:
        await conn.close()


def calculate_cost(total_requests: int) -> tuple[int, float]:
    """calculate billable requests and cost"""
    billable = max(0, total_requests - INCLUDED_REQUESTS)
    cost = billable * COST_PER_REQUEST
    return billable, cost


def display_dashboard(
    daily_data: list[dict[str, Any]],
    totals: dict[str, int],
    period_label: str,
    env: str,
) -> None:
    """render the cost dashboard"""
    console.print(f"\n[bold cyan]audd api costs[/] - {period_label} [{env}]\n")

    total = totals["total"]
    flagged = totals["flagged"]
    billable, cost = calculate_cost(total)
    remaining_free = max(0, INCLUDED_REQUESTS - total)

    # stats panel
    stats_table = Table(show_header=False, box=None, padding=(0, 2))
    stats_table.add_column(style="dim")
    stats_table.add_column(style="bold green", justify="right")

    stats_table.add_row("total scans", f"{total:,}")
    stats_table.add_row("flagged (matches)", f"{flagged:,}")
    stats_table.add_row("flag rate", f"{flagged / total * 100:.1f}%" if total else "0%")
    stats_table.add_row("", "")
    stats_table.add_row("included requests", f"{INCLUDED_REQUESTS:,}")
    stats_table.add_row("remaining free", f"{remaining_free:,}")
    stats_table.add_row("billable requests", f"{billable:,}")
    stats_table.add_row(
        "estimated cost",
        f"[{'red' if cost > 0 else 'green'}]${cost:.2f}[/]",
    )

    console.print(
        Panel(stats_table, title="[bold]usage & costs[/]", border_style="blue")
    )

    if not daily_data:
        console.print("[dim]no scan data available[/]")
        return

    # extract data - use indices for x-axis to avoid plotext date parsing
    dates = [d["date"].strftime("%m/%d") for d in daily_data]
    scans = [d["scans"] for d in daily_data]
    flagged_counts = [d["flagged"] for d in daily_data]
    x = list(range(len(dates)))

    # daily scans chart
    plt.clear_figure()
    plt.theme("dark")
    plt.title("daily scans")
    plt.bar(x, scans, color="cyan", label="scans")
    plt.xticks(x, dates)
    plt.plotsize(80, 12)
    plt.show()
    print()

    # cumulative cost projection
    cumulative = []
    running = 0
    for s in scans:
        running += s
        _, c = calculate_cost(running)
        cumulative.append(c)

    if any(c > 0 for c in cumulative):
        plt.clear_figure()
        plt.theme("dark")
        plt.title("cumulative cost ($)")
        plt.plot(x, cumulative, color="red", marker="braille")
        plt.xticks(x, dates)
        plt.plotsize(80, 10)
        plt.show()
        print()

    # flag rate over time
    rates = [f / s * 100 if s > 0 else 0 for f, s in zip(flagged_counts, scans)]
    plt.clear_figure()
    plt.theme("dark")
    plt.title("flag rate (%)")
    plt.plot(x, rates, color="yellow", marker="braille")
    plt.xticks(x, dates)
    plt.plotsize(80, 10)
    plt.show()
    print()


@app.command()
def main(
    all_time: bool = typer.Option(False, "--all", "-a", help="show all time stats"),
    env: str = typer.Option("prd", "--env", "-e", help="environment: prd, stg, dev"),
) -> None:
    """audd api cost tracker for plyr.fm"""
    try:
        db_url = settings.get_url(env)
    except ValueError as e:
        console.print(f"[red]error:[/] {e}")
        raise typer.Exit(1)

    async def run():
        if all_time:
            since = None
            label = "all time"
        else:
            since = get_billing_period_start()
            label = f"billing period (since {since.strftime('%b %d')})"

        daily_data = await query_scans(db_url, since)
        totals = await get_totals(db_url, since)
        display_dashboard(daily_data, totals, label, env)

    asyncio.run(run())


if __name__ == "__main__":
    app()
