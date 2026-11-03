"""Inventory the Python API surface used for Zig parity decisions."""

from __future__ import annotations

import argparse
import json
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


def resource_counts(routes: list[RouteInfo]) -> list[tuple[str, int, int]]:
    route_counts = Counter(resource_name(route.path) for route in routes)
    operation_counts = Counter(
        {
            resource: sum(
                len(route.methods)
                for route in routes
                if resource_name(route.path) == resource
            )
            for resource in route_counts
        }
    )
    return [
        (resource, route_count, operation_counts[resource])
        for resource, route_count in route_counts.most_common()
    ]


def print_summary(routes: list[RouteInfo]) -> None:
    operations = sum(len(route.methods) for route in routes)
    subsonic = sum(route.path.startswith("/rest/") for route in routes)

    print(f"runtime routes: {len(routes)}")
    print(f"method operations: {operations}")
    print(f"Subsonic routes: {subsonic}")
    print(f"Postgres tables: {len(Base.metadata.tables)}")
    print(f"Docket tasks: {len(background_tasks)}")
    print("\nsurface by top-level resource:")
    print("resource                 routes operations")
    for resource, route_count, operation_count in resource_counts(routes):
        print(f"{resource:24} {route_count:6} {operation_count:10}")


def print_routes(routes: list[RouteInfo]) -> None:
    print(
        "\nmethod(s)                path                                                    module"
    )
    for route in routes:
        methods = ",".join(route.methods)
        print(f"{methods:24} {route.path:55} {route.module}")


def print_json(routes: list[RouteInfo]) -> None:
    payload = {
        "summary": {
            "runtime_routes": len(routes),
            "method_operations": sum(len(route.methods) for route in routes),
            "subsonic_routes": sum(route.path.startswith("/rest/") for route in routes),
            "postgres_tables": len(Base.metadata.tables),
            "docket_tasks": len(background_tasks),
        },
        "resources": [
            {
                "name": resource,
                "routes": route_count,
                "operations": operation_count,
            }
            for resource, route_count, operation_count in resource_counts(routes)
        ],
        "routes": [
            {
                "path": route.path,
                "methods": list(route.methods),
                "module": route.module,
            }
            for route in routes
        ],
    }
    print(json.dumps(payload, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--routes", action="store_true", help="print every route")
    output.add_argument(
        "--json", action="store_true", help="emit the complete inventory as JSON"
    )
    args = parser.parse_args()

    routes = collect_routes()
    if args.json:
        print_json(routes)
        return

    print_summary(routes)
    if args.routes:
        print_routes(routes)


if __name__ == "__main__":
    main()
