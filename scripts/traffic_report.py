#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "rich", "plotext", "pydantic-settings", "typer"]
# ///
"""coupled traffic report — Cloudflare edge + Logfire app-server, side by side.

two lenses on the same days:
  - Cloudflare (edge):  total requests, bytes, cache-hit %, unique visitors,
    threats — sees anonymous CDN traffic that never reaches origin.
  - Logfire (app):      authenticated requests, distinct signed-in users,
    uploads, p95 latency, error rate — what the backend actually handled.

usage:
    uv run scripts/traffic_report.py            # last 7 days
    uv run scripts/traffic_report.py -d 30       # last 30 days (CF retention cap)
    uv run scripts/traffic_report.py -d 1        # last 24h

credentials (.env):
    SCRIPT_CF_API_TOKEN   — needs Zone Analytics: Read on the plyr.fm zone
    LOGFIRE_READ_API_TOKEN    — a Logfire *read* token for the plyr-fm project
                            (Logfire dashboard → project → settings → read tokens)

both halves degrade independently: if one credential is missing or a horizon
exceeds a tool's retention, that lens is skipped with a note rather than
failing the whole report.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import plotext as plt
import typer
from pydantic_settings import BaseSettings, SettingsConfigDict
from rich.console import Console
from rich.table import Table

ZONE_ID = "2bfcb9ffe7847604e9febbb62d9649a3"
CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql"
LOGFIRE_QUERY_URL = "https://logfire-api.pydantic.dev/v1/query"

# Logfire caps a single query at 14 days; chunk longer windows.
LOGFIRE_MAX_WINDOW_DAYS = 14
# Cloudflare httpRequests1dGroups retention is ~30 days regardless of limit.
CF_RETENTION_DAYS = 30

console = Console()
app = typer.Typer(add_completion=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    script_cf_api_token: str | None = None
    logfire_read_api_token: str | None = None


# --------------------------------------------------------------------------- #
# Cloudflare (edge lens)
# --------------------------------------------------------------------------- #


def fetch_cloudflare(token: str, days: int) -> list[dict[str, Any]]:
    """daily edge stats from the zone's httpRequests1dGroups."""
    since = (datetime.now(UTC).date() - timedelta(days=days)).isoformat()
    query = """
    query($zone: String!, $since: Date!) {
      viewer { zones(filter: {zoneTag: $zone}) {
        httpRequests1dGroups(filter: {date_geq: $since}, orderBy: [date_ASC], limit: 200) {
          dimensions { date }
          sum { requests bytes cachedBytes threats }
          uniq { uniques }
        }
      } }
    }
    """
    resp = httpx.post(
        CF_GRAPHQL,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"query": query, "variables": {"zone": ZONE_ID, "since": since}},
        timeout=30,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        raise RuntimeError(f"Cloudflare GraphQL: {payload['errors']}")
    # NOTE: the API unwraps to result under "data", not "data.data"
    groups = payload["data"]["viewer"]["zones"][0]["httpRequests1dGroups"]
    rows = []
    for g in groups:
        b, cb = g["sum"]["bytes"], g["sum"]["cachedBytes"]
        rows.append(
            {
                "date": g["dimensions"]["date"],
                "requests": g["sum"]["requests"],
                "bytes": b,
                "cache_pct": (cb / b * 100) if b else 0.0,
                "threats": g["sum"]["threats"],
                "visitors": g["uniq"]["uniques"],
            }
        )
    return rows


# --------------------------------------------------------------------------- #
# Logfire (app lens)
# --------------------------------------------------------------------------- #


def _logfire_query(
    token: str, sql: str, min_ts: datetime, max_ts: datetime
) -> list[dict[str, Any]]:
    resp = httpx.get(
        LOGFIRE_QUERY_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "sql": sql,
            "min_timestamp": min_ts.isoformat(),
            "max_timestamp": max_ts.isoformat(),
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    cols = [c["name"] for c in data["columns"]]
    # columns-of-arrays → list-of-dicts
    series = {c["name"]: c["values"] for c in data["columns"]}
    n = len(next(iter(series.values()))) if series else 0
    return [{c: series[c][i] for c in cols} for i in range(n)]


def fetch_logfire(token: str, days: int) -> list[dict[str, Any]]:
    """daily app-server stats, chunked to respect the 14-day query cap."""
    now = datetime.now(UTC)
    sql = """
    SELECT
      date_trunc('day', start_timestamp) AS day,
      COUNT(*) FILTER (WHERE http_method IS NOT NULL AND http_route != '/health' AND kind='span') AS requests,
      COUNT(DISTINCT attributes->>'user.did') AS users,
      COUNT(*) FILTER (WHERE span_name='process upload background') AS uploads,
      ROUND((approx_percentile_cont(duration, 0.95) FILTER (WHERE http_route != '/health') * 1000)::numeric, 0) AS p95_ms,
      COUNT(*) FILTER (WHERE http_response_status_code >= 500) AS server_errors
    FROM records
    WHERE deployment_environment='production'
      AND (
        (http_method IS NOT NULL AND http_route != '/health' AND kind='span')
        OR span_name='process upload background'
      )
    GROUP BY date_trunc('day', start_timestamp)
    ORDER BY day ASC
    """
    by_day: dict[str, dict[str, Any]] = {}
    remaining = days
    window_end = now
    while remaining > 0:
        chunk = min(remaining, LOGFIRE_MAX_WINDOW_DAYS)
        window_start = window_end - timedelta(days=chunk)
        for r in _logfire_query(token, sql, window_start, window_end):
            day = str(r["day"])[:10]
            by_day[day] = {
                "date": day,
                "requests": int(r["requests"] or 0),
                "users": int(r["users"] or 0),
                "uploads": int(r["uploads"] or 0),
                "p95_ms": int(r["p95_ms"] or 0),
                "server_errors": int(r["server_errors"] or 0),
            }
        window_end = window_start
        remaining -= chunk
    return [by_day[d] for d in sorted(by_day)]


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #


def _fmt_bytes(b: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


def _bar(title: str, labels: list[str], values: list[float], color: str) -> None:
    plt.clear_figure()
    plt.theme("dark")
    plt.title(title)
    plt.bar(labels, values, color=color)
    plt.plotsize(90, 14)
    plt.show()
    print()


def _dual_line(
    title: str,
    labels: list[str],
    a: tuple[str, list[float]],
    b: tuple[str, list[float]],
) -> None:
    plt.clear_figure()
    plt.theme("dark")
    plt.title(title)
    x = list(range(len(labels)))
    plt.plot(x, a[1], label=a[0], color="cyan", marker="braille")
    plt.plot(x, b[1], label=b[0], color="magenta", marker="braille")
    plt.xticks(x, labels)
    plt.plotsize(90, 14)
    plt.show()
    print()


def render(
    days: int, cf: list[dict] | None, lf: list[dict] | None, cf_err, lf_err
) -> None:
    console.print(
        f"\n[bold cyan]plyr.fm traffic[/] — last {days} days  "
        "[dim](edge=Cloudflare · app=Logfire)[/]\n"
    )

    # ---- summary table (coupled) ----
    t = Table(title="summary", title_style="bold")
    t.add_column("lens", style="dim")
    t.add_column("metric")
    t.add_column("value", justify="right", style="bold green")
    # `kind` makes the math honest: "window" rows are true sums over the
    # horizon; "daily" rows are per-day stats (peak / avg) because the source
    # only dedups within a day — there's no cross-window unique to sum.
    t.add_column("kind", style="dim", justify="right")

    def _daily(values: list[float]) -> str:
        return f"peak {max(values):,.0f} · avg {sum(values) / len(values):,.0f}"

    if cf:
        byt = sum(r["bytes"] for r in cf)
        cab = sum(r["bytes"] * r["cache_pct"] / 100 for r in cf)
        t.add_row("edge", "requests", f"{sum(r['requests'] for r in cf):,}", "window")
        t.add_row("edge", "bandwidth", _fmt_bytes(byt), "window")
        t.add_row(
            "edge", "cache hit %", f"{(cab / byt * 100) if byt else 0:.1f}%", "window"
        )
        t.add_row(
            "edge", "threats blocked", f"{sum(r['threats'] for r in cf):,}", "window"
        )
        t.add_row(
            "edge", "unique visitors", _daily([r["visitors"] for r in cf]), "daily"
        )
    else:
        t.add_row("edge", "—", f"[red]unavailable: {cf_err}[/]", "")
    if lf:
        t.add_row(
            "app", "authed requests", f"{sum(r['requests'] for r in lf):,}", "window"
        )
        t.add_row("app", "uploads", f"{sum(r['uploads'] for r in lf):,}", "window")
        t.add_row(
            "app", "5xx errors", f"{sum(r['server_errors'] for r in lf):,}", "window"
        )
        t.add_row("app", "signed-in users", _daily([r["users"] for r in lf]), "daily")
    else:
        t.add_row("app", "—", f"[red]unavailable: {lf_err}[/]", "")
    console.print(t)
    console.print(
        "[dim]window = true total over the horizon · daily = per-day stat "
        "(no cross-day dedup available for unique counts)[/]"
    )
    print()

    # ---- coupled requests: edge vs origin ----
    if cf and lf:
        # align on the intersection of dates so the two series line up
        cf_by = {r["date"]: r for r in cf}
        lf_by = {r["date"]: r for r in lf}
        days_x = sorted(set(cf_by) & set(lf_by))
        if days_x:
            short = [d[5:] for d in days_x]
            _dual_line(
                "requests/day — edge (total) vs app (origin, authed)",
                short,
                ("edge", [cf_by[d]["requests"] for d in days_x]),
                ("app", [lf_by[d]["requests"] for d in days_x]),
            )
            _dual_line(
                "audience/day — edge visitors vs app signed-in users",
                short,
                ("edge visitors", [cf_by[d]["visitors"] for d in days_x]),
                ("app users", [lf_by[d]["users"] for d in days_x]),
            )

    # ---- edge-only charts ----
    if cf:
        labels = [r["date"][5:] for r in cf]
        _bar(
            "edge: bandwidth/day (GB)",
            labels,
            [r["bytes"] / 1024**3 for r in cf],
            "cyan",
        )
        _bar(
            "edge: cache hit %/day",
            labels,
            [round(r["cache_pct"], 1) for r in cf],
            "green",
        )

    # ---- app-only charts ----
    if lf:
        labels = [r["date"][5:] for r in lf]
        _bar("app: uploads/day", labels, [r["uploads"] for r in lf], "magenta")
        if any(r["p95_ms"] for r in lf):
            _bar(
                "app: p95 latency/day (ms)", labels, [r["p95_ms"] for r in lf], "yellow"
            )

    console.print()


@app.command()
def main(
    days: int = typer.Option(7, "-d", "--days", help="lookback window in days"),
) -> None:
    s = Settings()
    if days > CF_RETENTION_DAYS:
        console.print(
            f"[yellow]note:[/] Cloudflare retention is ~{CF_RETENTION_DAYS}d; "
            f"edge data will be truncated."
        )

    cf = lf = None
    cf_err = lf_err = None

    if s.script_cf_api_token:
        try:
            cf = fetch_cloudflare(s.script_cf_api_token, days)
        except Exception as e:  # noqa: BLE001
            cf_err = str(e)[:200]
    else:
        cf_err = "SCRIPT_CF_API_TOKEN not set"

    if s.logfire_read_api_token:
        try:
            lf = fetch_logfire(s.logfire_read_api_token, days)
        except Exception as e:  # noqa: BLE001
            lf_err = str(e)[:200]
    else:
        lf_err = "LOGFIRE_READ_API_TOKEN not set"

    if not cf and not lf:
        console.print(
            f"[red]both lenses unavailable.[/] edge: {cf_err} · app: {lf_err}"
        )
        raise typer.Exit(1)

    render(days, cf, lf, cf_err, lf_err)


if __name__ == "__main__":
    app()
