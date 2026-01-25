#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.28.0"]
# ///
"""
transcoder test matrix - tests format conversion across input/output combinations.

usage:
    # run all tests against local transcoder
    uv run scripts/transcoder/test-matrix.py

    # run against production (requires TRANSCODER_AUTH_TOKEN)
    uv run scripts/transcoder/test-matrix.py --url https://plyr-transcoder.fly.dev

    # run specific input format only
    uv run scripts/transcoder/test-matrix.py --input-format aiff

    # verbose output
    uv run scripts/transcoder/test-matrix.py -v
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

# test matrix configuration
INPUT_FORMATS = ["aiff", "flac", "wav", "mp3", "m4a"]
OUTPUT_FORMATS = ["mp3", "m4a", "wav"]

# sample generation parameters
SAMPLE_DURATION = 2  # seconds
SAMPLE_RATE = 44100
CHANNELS = 2


@dataclass
class TestResult:
    input_format: str
    output_format: str
    success: bool
    duration_ms: float
    input_size: int
    output_size: int
    error: str | None = None


def generate_sample(output_path: Path, format: str) -> bool:
    """generate a test audio sample using ffmpeg."""
    cmd = [
        sys.executable,
        "scripts/generate_audio_sample.py",
        str(output_path),
        "--waveform",
        "sine",
        "--duration",
        str(SAMPLE_DURATION),
        "--sample-rate",
        str(SAMPLE_RATE),
        "--channels",
        str(CHANNELS),
        "--frequency",
        "440",
        "--fade-in",
        "0.1",
        "--fade-out",
        "0.1",
        "--force",
        "--log-level",
        "error",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0


def transcode_file(
    input_path: Path,
    target_format: str,
    url: str,
    auth_token: str | None,
    timeout: float = 60.0,
) -> tuple[bytes | None, str | None]:
    """send file to transcoder and return result."""
    headers = {}
    if auth_token:
        headers["X-Transcoder-Key"] = auth_token

    try:
        with open(input_path, "rb") as f:
            files = {"file": (input_path.name, f)}
            response = httpx.post(
                f"{url}/transcode",
                params={"target": target_format},
                files=files,
                headers=headers,
                timeout=timeout,
            )

        if response.status_code == 200:
            return response.content, None
        else:
            return None, f"HTTP {response.status_code}: {response.text[:200]}"
    except httpx.TimeoutException:
        return None, "timeout"
    except Exception as e:
        return None, str(e)


def verify_audio(file_path: Path) -> bool:
    """verify audio file is valid using ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        str(file_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return False
    try:
        duration = float(result.stdout.strip())
        # allow some tolerance for duration
        return duration > SAMPLE_DURATION * 0.8
    except ValueError:
        return False


def run_test(
    input_format: str,
    output_format: str,
    samples_dir: Path,
    url: str,
    auth_token: str | None,
    verbose: bool = False,
) -> TestResult:
    """run a single transcoding test."""
    input_path = samples_dir / f"test.{input_format}"

    if not input_path.exists():
        return TestResult(
            input_format=input_format,
            output_format=output_format,
            success=False,
            duration_ms=0,
            input_size=0,
            output_size=0,
            error=f"input file not found: {input_path}",
        )

    input_size = input_path.stat().st_size
    start = time.perf_counter()

    result_bytes, error = transcode_file(input_path, output_format, url, auth_token)

    duration_ms = (time.perf_counter() - start) * 1000

    if error:
        return TestResult(
            input_format=input_format,
            output_format=output_format,
            success=False,
            duration_ms=duration_ms,
            input_size=input_size,
            output_size=0,
            error=error,
        )

    # write output and verify
    output_path = (
        samples_dir / f"output_{input_format}_to_{output_format}.{output_format}"
    )
    output_path.write_bytes(result_bytes)
    output_size = len(result_bytes)

    if not verify_audio(output_path):
        return TestResult(
            input_format=input_format,
            output_format=output_format,
            success=False,
            duration_ms=duration_ms,
            input_size=input_size,
            output_size=output_size,
            error="output validation failed",
        )

    return TestResult(
        input_format=input_format,
        output_format=output_format,
        success=True,
        duration_ms=duration_ms,
        input_size=input_size,
        output_size=output_size,
    )


def print_matrix(
    results: list[TestResult], input_formats: list[str], output_formats: list[str]
):
    """print results as a matrix table."""
    # build lookup
    lookup = {(r.input_format, r.output_format): r for r in results}

    # header
    col_width = 10
    header = (
        "input".ljust(col_width)
        + " | "
        + " | ".join(f.center(col_width) for f in output_formats)
    )
    print("\n" + header)
    print("-" * len(header))

    # rows
    for inf in input_formats:
        row = inf.ljust(col_width) + " | "
        cells = []
        for outf in output_formats:
            r = lookup.get((inf, outf))
            if r is None:
                cells.append("skip".center(col_width))
            elif r.success:
                cells.append(f"{r.duration_ms:.0f}ms".center(col_width))
            else:
                cells.append("FAIL".center(col_width))
        row += " | ".join(cells)
        print(row)


def main():
    parser = argparse.ArgumentParser(description="Transcoder test matrix")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8082",
        help="Transcoder URL (default: http://127.0.0.1:8082)",
    )
    parser.add_argument(
        "--input-format",
        choices=INPUT_FORMATS,
        help="Test only this input format",
    )
    parser.add_argument(
        "--output-format",
        choices=OUTPUT_FORMATS,
        help="Test only this output format",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose output",
    )
    parser.add_argument(
        "--keep-files",
        action="store_true",
        help="Keep generated test files (useful for debugging)",
    )
    args = parser.parse_args()

    # get auth token from environment
    auth_token = os.environ.get("TRANSCODER_AUTH_TOKEN")
    if "fly.dev" in args.url and not auth_token:
        print(
            "error: TRANSCODER_AUTH_TOKEN required for production URL", file=sys.stderr
        )
        sys.exit(1)

    # check transcoder is running
    try:
        response = httpx.get(f"{args.url}/health", timeout=5.0)
        if response.status_code != 200:
            print(
                f"error: transcoder health check failed: {response.status_code}",
                file=sys.stderr,
            )
            sys.exit(1)
    except Exception as e:
        print(f"error: cannot reach transcoder at {args.url}: {e}", file=sys.stderr)
        print("hint: start with `just transcoder run`", file=sys.stderr)
        sys.exit(1)

    # determine formats to test
    input_formats = [args.input_format] if args.input_format else INPUT_FORMATS
    output_formats = [args.output_format] if args.output_format else OUTPUT_FORMATS

    # create temp directory for test files
    if args.keep_files:
        samples_dir = Path("sandbox/transcoder-test")
        samples_dir.mkdir(parents=True, exist_ok=True)
    else:
        temp_dir = tempfile.mkdtemp(prefix="transcoder-test-")
        samples_dir = Path(temp_dir)

    print(f"transcoder: {args.url}")
    print(f"test files: {samples_dir}")
    print(f"matrix: {len(input_formats)} inputs x {len(output_formats)} outputs")
    print()

    # generate input samples
    print("generating test samples...")
    for fmt in input_formats:
        sample_path = samples_dir / f"test.{fmt}"
        if args.verbose:
            print(f"  {fmt}...", end=" ", flush=True)
        if generate_sample(sample_path, fmt):
            if args.verbose:
                print(f"{sample_path.stat().st_size} bytes")
        else:
            print(f"failed to generate {fmt} sample", file=sys.stderr)
            sys.exit(1)

    # run test matrix
    print("\nrunning transcoding tests...")
    results: list[TestResult] = []

    for inf in input_formats:
        for outf in output_formats:
            if args.verbose:
                print(f"  {inf} -> {outf}...", end=" ", flush=True)

            result = run_test(
                inf, outf, samples_dir, args.url, auth_token, args.verbose
            )
            results.append(result)

            if args.verbose:
                if result.success:
                    print(
                        f"{result.duration_ms:.0f}ms ({result.input_size} -> {result.output_size} bytes)"
                    )
                else:
                    print(f"FAILED: {result.error}")

    # print matrix summary
    print_matrix(results, input_formats, output_formats)

    # print failures
    failures = [r for r in results if not r.success]
    if failures:
        print(f"\n{len(failures)} failures:")
        for r in failures:
            print(f"  {r.input_format} -> {r.output_format}: {r.error}")

    # cleanup
    if not args.keep_files:
        shutil.rmtree(samples_dir)

    # exit code
    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
