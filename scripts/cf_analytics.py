#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "rich", "pydantic-settings", "plotext", "typer"]
# ///
"""cloudflare analytics dashboard - vanity metrics at your fingertips

usage:
    uv run scripts/cf_analytics.py              # last 7 days (default)
    uv run scripts/cf_analytics.py --days 30    # last 30 days
    uv run scripts/cf_analytics.py -d 14        # last 14 days
    uv run scripts/cf_analytics.py --no-cache   # force refresh
"""

import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import plotext as plt
import typer
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console
from rich.panel import Panel
from rich.table import Table


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    cf_api_token: str
    cf_zone_id: str | None = None
    cf_account_id: str | None = None


settings = Settings()

GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"
CACHE_DIR = Path.home() / ".cache" / "plyr-analytics"

console = Console()
app = typer.Typer(add_completion=False)


def get_cache_path(query_type: str, days: int) -> Path:
    """get cache file path for a query"""
    today = datetime.now().strftime("%Y-%m-%d")
    key = f"{query_type}-{days}-{today}"
    return CACHE_DIR / f"{hashlib.md5(key.encode()).hexdigest()[:12]}.json"


def load_cache(query_type: str, days: int) -> dict[str, Any] | None:
    """load cached data if valid (same calendar day)"""
    cache_path = get_cache_path(query_type, days)
    if cache_path.exists():
        try:
            data = json.loads(cache_path.read_text())
            data.pop("_cached_date", None)  # strip metadata before returning
            console.print(f"[dim]using cached {query_type} data[/]")
            return data
        except (json.JSONDecodeError, KeyError):
            cache_path.unlink(missing_ok=True)
    return None


def save_cache(query_type: str, days: int, data: dict[str, Any]) -> None:
    """save data to cache"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = get_cache_path(query_type, days)
    cached = {"_cached_date": datetime.now().strftime("%Y-%m-%d"), **data}
    cache_path.write_text(json.dumps(cached))


def clear_old_cache() -> None:
    """remove cache files from previous days"""
    if not CACHE_DIR.exists():
        return
    today = datetime.now().strftime("%Y-%m-%d")
    for f in CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            if data.get("_cached_date") != today:
                f.unlink()
        except (json.JSONDecodeError, KeyError):
            f.unlink()


def query_cf(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """hit the cloudflare graphql api"""
    headers = {
        "Authorization": f"Bearer {settings.cf_api_token}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {"query": query}
    if variables:
        payload["variables"] = variables

    resp = httpx.post(GRAPHQL_ENDPOINT, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    if data.get("errors"):
        raise Exception(f"GraphQL errors: {data['errors']}")

    return data["data"]


def get_zone_analytics(days: int = 7, use_cache: bool = True) -> dict[str, Any]:
    """get HTTP request analytics for the zone"""
    if use_cache and (cached := load_cache("zone", days)):
        return cached

    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = """
    query ZoneAnalytics($zoneTag: String!, $since: Date!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequests1dGroups(
            filter: {date_gt: $since}
            orderBy: [date_ASC]
            limit: 100
          ) {
            dimensions {
              date
            }
            sum {
              requests
              pageViews
              bytes
              cachedBytes
              threats
            }
            uniq {
              uniques
            }
          }
        }
      }
    }
    """

    result = query_cf(query, {"zoneTag": settings.cf_zone_id, "since": start_date})
    save_cache("zone", days, result)
    return result


def get_web_analytics(days: int = 7, use_cache: bool = True) -> dict[str, Any]:
    """get RUM/web analytics (actual browser visits)"""
    if use_cache and (cached := load_cache("rum", days)):
        return cached

    since = (datetime.now() - timedelta(days=days)).isoformat() + "Z"

    query = """
    query WebAnalytics($accountTag: String!, $since: Time!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          rumPageloadEventsAdaptiveGroups(
            filter: {datetime_gt: $since}
            limit: 5000
          ) {
            count
            sum {
              visits
            }
            dimensions {
              date: date
            }
          }
        }
      }
    }
    """

    result = query_cf(query, {"accountTag": settings.cf_account_id, "since": since})
    save_cache("rum", days, result)
    return result


def get_top_paths(days: int = 7) -> dict[str, Any]:
    """get top pages by requests"""
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = """
    query TopPaths($zoneTag: String!, $since: Date!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequests1dGroups(
            filter: {date_gt: $since}
            orderBy: [sum_requests_DESC]
            limit: 10
          ) {
            sum {
              requests
            }
            dimensions {
              clientRequestPath
            }
          }
        }
      }
    }
    """

    return query_cf(query, {"zoneTag": settings.cf_zone_id, "since": start_date})


def get_countries(days: int = 7) -> dict[str, Any]:
    """get requests by country"""
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = """
    query Countries($zoneTag: String!, $since: Date!) {
      viewer {
        zones(filter: {zoneTag: $zoneTag}) {
          httpRequests1dGroups(
            filter: {date_gt: $since}
            orderBy: [sum_requests_DESC]
            limit: 10
          ) {
            sum {
              requests
            }
            dimensions {
              clientCountryName
            }
          }
        }
      }
    }
    """

    return query_cf(query, {"zoneTag": settings.cf_zone_id, "since": start_date})


def format_bytes(b: int) -> str:
    """human readable bytes"""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


def display_dashboard(days: int = 7, use_cache: bool = True) -> None:
    """render the vanity dashboard"""
    clear_old_cache()
    console.print(f"\n[bold cyan]plyr.fm analytics[/] - last {days} days\n")

    # zone analytics
    if settings.cf_zone_id:
        try:
            data = get_zone_analytics(days, use_cache=use_cache)
            groups = data["viewer"]["zones"][0]["httpRequests1dGroups"]

            total_requests = sum(g["sum"]["requests"] for g in groups)
            total_pageviews = sum(g["sum"]["pageViews"] for g in groups)
            total_bytes = sum(g["sum"]["bytes"] for g in groups)
            total_cached = sum(g["sum"]["cachedBytes"] for g in groups)
            total_uniques = sum(g["uniq"]["uniques"] for g in groups)
            total_threats = sum(g["sum"]["threats"] for g in groups)

            cache_ratio = (total_cached / total_bytes * 100) if total_bytes > 0 else 0

            stats_table = Table(show_header=False, box=None, padding=(0, 2))
            stats_table.add_column(style="dim")
            stats_table.add_column(style="bold green", justify="right")

            stats_table.add_row("total requests", f"{total_requests:,}")
            stats_table.add_row("page views", f"{total_pageviews:,}")
            stats_table.add_row("unique visitors", f"{total_uniques:,}")
            stats_table.add_row("bandwidth", format_bytes(total_bytes))
            stats_table.add_row("cache hit ratio", f"{cache_ratio:.1f}%")
            stats_table.add_row("threats blocked", f"{total_threats:,}")

            console.print(
                Panel(stats_table, title="[bold]zone stats[/]", border_style="blue")
            )

            # extract data for charts
            dates = [g["dimensions"]["date"][-5:] for g in groups]  # MM-DD
            requests = [g["sum"]["requests"] for g in groups]
            pageviews = [g["sum"]["pageViews"] for g in groups]
            uniques = [g["uniq"]["uniques"] for g in groups]

            # requests bar chart
            plt.clear_figure()
            plt.theme("dark")
            plt.title("daily requests")
            plt.bar(dates, requests, color="cyan")
            plt.plotsize(80, 15)
            plt.show()
            print()

            # pageviews vs uniques line chart
            plt.clear_figure()
            plt.theme("dark")
            plt.title("pageviews vs unique visitors")
            x = list(range(len(dates)))
            plt.plot(x, pageviews, label="pageviews", color="green", marker="braille")
            plt.plot(x, uniques, label="uniques", color="magenta", marker="braille")
            plt.xticks(x, dates)
            plt.plotsize(80, 15)
            plt.show()
            print()

        except Exception as e:
            console.print(f"[red]zone analytics error:[/] {e}")

    # web analytics (RUM)
    if settings.cf_account_id:
        try:
            data = get_web_analytics(days, use_cache=use_cache)
            groups = data["viewer"]["accounts"][0]["rumPageloadEventsAdaptiveGroups"]

            total_visits = sum(g["sum"]["visits"] for g in groups)
            total_pageloads = sum(g["count"] for g in groups)

            rum_table = Table(show_header=False, box=None, padding=(0, 2))
            rum_table.add_column(style="dim")
            rum_table.add_column(style="bold magenta", justify="right")

            rum_table.add_row("visits (RUM)", f"{total_visits:,}")
            rum_table.add_row("page loads", f"{total_pageloads:,}")

            console.print(
                Panel(rum_table, title="[bold]web analytics[/]", border_style="magenta")
            )

        except Exception as e:
            console.print(f"[yellow]web analytics:[/] {e}")

    console.print()


@app.command()
def main(
    days: int = typer.Option(7, "-d", "--days", help="number of days to look back"),
    no_cache: bool = typer.Option(False, "--no-cache", help="force refresh from API"),
) -> None:
    """cloudflare analytics dashboard for plyr.fm"""
    if not settings.cf_zone_id and not settings.cf_account_id:
        console.print("[red]error:[/] set CF_ZONE_ID and/or CF_ACCOUNT_ID in .env")
        raise typer.Exit(1)

    display_dashboard(days, use_cache=not no_cache)


if __name__ == "__main__":
    app()
