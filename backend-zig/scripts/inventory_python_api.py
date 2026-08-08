"""Inventory the Python API surface used for Zig parity decisions."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from typing import Any

from backend._internal.tasks import background_tasks
from backend.main import app
from backend.models.database import Base


@dataclass(frozen=True)
class RouteInfo:
    path: str
    methods: tuple[str, ...]
    module: str


def collect_routes() -> list[RouteInfo]:
    routes: list[RouteInfo] = []
    for route in app.routes:
        endpoint: Any = getattr(route, "endpoint", None)
        module = getattr(endpoint, "__module__", "")
        if not module.startswith("backend."):
            continue

        methods = tuple(sorted(getattr(route, "methods", []) or ("WEBSOCKET",)))
        routes.append(RouteInfo(path=route.path, methods=methods, module=module))
    return routes


def resource_name(path: str) -> str:
    return path.strip("/").split("/", 1)[0] or "root"


def print_summary(routes: list[RouteInfo]) -> None:
    operations = sum(len(route.methods) for route in routes)
    subsonic = sum(route.path.startswith("/rest/") for route in routes)

    print(f"runtime routes: {len(routes)}")
    print(f"method operations: {operations}")
    print(f"Subsonic routes: {subsonic}")
    print(f"Postgres tables: {len(Base.metadata.tables)}")
    print(f"Docket tasks: {len(background_tasks)}")
    print("\nroutes by top-level resource:")
    counts = Counter(resource_name(route.path) for route in routes)
    for resource, count in counts.most_common():
        print(f"{resource:24} {count:3}")


def print_routes(routes: list[RouteInfo]) -> None:
    print(
        "\nmethod(s)                path                                                    module"
    )
    for route in routes:
        methods = ",".join(route.methods)
        print(f"{methods:24} {route.path:55} {route.module}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--routes", action="store_true", help="print every route")
    args = parser.parse_args()

    routes = collect_routes()
    print_summary(routes)
    if args.routes:
        print_routes(routes)


if __name__ == "__main__":
    main()
