"""Check the real search SQL against the isolated 20k-row benchmark fixture."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def search_sql() -> str:
    source = (ROOT / "src/internal/index/postgres_search_store.zig").read_text()
    declaration = source.split("const search_query =", 1)[1]
    return "\n".join(
        line.lstrip()[2:]
        for line in declaration.splitlines()
        if line.lstrip().startswith("\\\\")
    )


def metric_loops(node: dict[str, Any]) -> list[int]:
    own = [node["Actual Loops"]] if node.get("Relation Name") == "track_metrics" else []
    return own + [
        loops for child in node.get("Plans", []) for loops in metric_loops(child)
    ]


def main() -> None:
    sql = (
        "PREPARE search(text,text,text,text,boolean,boolean,boolean,boolean,bigint) AS\n"
        + search_sql()
        + ";\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE search("
        "'di','fm.plyr.dev.track','fm.plyr.dev.list','fm.plyr.dev.actor.profile',"
        "true,false,false,false,20);\n"
    )
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(ROOT / "compose.yaml"),
            "exec",
            "-T",
            "bench-db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "zig_bench",
            "-d",
            "zig_bench",
            "-qAt",
        ],
        input=sql,
        text=True,
        capture_output=True,
        check=True,
    )
    plan = json.loads(result.stdout)[0]
    probes = metric_loops(plan["Plan"])
    if plan["Plan"]["Actual Rows"] != 20 or not probes or max(probes) > 20:
        raise RuntimeError(
            f"metrics hydration is not bounded by the result limit: {probes}"
        )
    print(
        json.dumps(
            {"execution_ms": plan["Execution Time"], "metric_probe_loops": probes}
        )
    )


if __name__ == "__main__":
    main()
