#!/usr/bin/env -S uv run --script --quiet
"""Utility CLI for generating synthetic audio snippets with ffmpeg.

Examples:
    # 3 second stereo sine wave @ 440 Hz written to tmp.wav
    uv run scripts/generate_audio_sample.py tmp.wav --duration 3

    # pink noise bed with gentle fades
    uv run scripts/generate_audio_sample.py pink.wav --waveform noise \\
        --noise-color pink --duration 15 --fade-in 1.5 --fade-out 2

    # chord built from multiple partials
    uv run scripts/generate_audio_sample.py chord.wav --partials 660 \\
        --partials 880:0.35 --duration 5 --frequency 440 --amplitude 0.6
"""

from __future__ import annotations

import argparse
import shlex
import shutil
import subprocess
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path

LOG_LEVELS = [
    "quiet",
    "panic",
    "fatal",
    "error",
    "warning",
    "info",
    "verbose",
    "debug",
    "trace",
]


def positive_float(value: str) -> float:
    num = float(value)
    if num <= 0:
        raise argparse.ArgumentTypeError(f"value must be > 0 (got {value})")
    return num


def non_negative_float(value: str) -> float:
    num = float(value)
    if num < 0:
        raise argparse.ArgumentTypeError(f"value must be >= 0 (got {value})")
    return num


def amplitude_value(value: str) -> float:
    num = float(value)
    if not 0 < num <= 1:
        raise argparse.ArgumentTypeError(
            "amplitude must be between 0 and 1 (exclusive)"
        )
    return num


def positive_int(value: str) -> int:
    num = int(value)
    if num <= 0:
        raise argparse.ArgumentTypeError(f"value must be > 0 (got {value})")
    return num


def parse_partial(value: str) -> tuple[float, float]:
    freq_part, _, level_part = value.partition(":")
    freq = positive_float(freq_part)
    level = float(level_part) if level_part else 1.0
    if level <= 0:
        raise argparse.ArgumentTypeError("partial weight must be > 0")
    return freq, level


def parse_tag_pairs(pairs: Sequence[str]) -> list[tuple[str, str]]:
    parsed: list[tuple[str, str]] = []
    for pair in pairs:
        if "=" not in pair:
            raise argparse.ArgumentTypeError(
                f"metadata tags must look like KEY=VALUE (got {pair})"
            )
        key, value = pair.split("=", 1)
        key = key.strip()
        if not key:
            raise argparse.ArgumentTypeError("metadata key cannot be empty")
        parsed.append((key, value.strip()))
    return parsed


def wave_expression(waveform: str, frequency: float) -> str:
    angular = f"2*PI*{frequency}*t"
    base = f"t*{frequency}"

    if waveform == "sine":
        return f"sin({angular})"
    if waveform == "square":
        return f"(gt(sin({angular}),0)*2-1)"
    if waveform == "triangle":
        return f"(abs(4*(({base})-floor({base}+0.75))-2)-1)"
    if waveform == "saw":
        return f"(2*((({base})-floor({base}+0.5))))"
    raise ValueError(f"unsupported waveform {waveform}")


def build_tone_filtergraph(
    waveform: str,
    frequency: float,
    duration: float,
    sample_rate: int,
    amplitude: float,
    partials: Iterable[tuple[float, float]],
) -> str:
    if waveform != "sine" and list(partials):
        raise ValueError("--partials are only supported when waveform is 'sine'")

    expr = wave_expression(waveform, frequency)

    if waveform == "sine":
        terms: list[tuple[str, float]] = [(expr, 1.0)]
        for freq, weight in partials:
            terms.append((wave_expression("sine", freq), weight))
        total_weight = sum(weight for _, weight in terms)
        combined = "+".join(f"{weight}*({term})" for term, weight in terms)
        expr = f"({combined})/{total_weight}"

    expr = f"{amplitude}*({expr})"
    return f"aevalsrc=exprs='{expr}':s={sample_rate}:d={duration}"


def build_noise_filtergraph(
    color: str, duration: float, sample_rate: int, amplitude: float
) -> str:
    return (
        "anoisesrc="
        f"color={color}:"
        f"sample_rate={sample_rate}:"
        f"duration={duration}:"
        f"amplitude={amplitude}"
    )


def apply_fades(graph: str, duration: float, fade_in: float, fade_out: float) -> str:
    filters = [graph]
    if fade_in > 0:
        filters.append(f"afade=t=in:ss=0:d={fade_in}")
    if fade_out > 0:
        start = max(duration - fade_out, 0)
        filters.append(f"afade=t=out:st={start}:d={fade_out}")
    return ",".join(filters)


def build_ffmpeg_command(
    lavfi_graph: str,
    output: Path,
    duration: float,
    sample_rate: int,
    channels: int,
    log_level: str,
    force: bool,
    metadata: Sequence[tuple[str, str]],
) -> list[str]:
    cmd: list[str] = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        log_level,
        "-f",
        "lavfi",
        "-i",
        lavfi_graph,
        "-t",
        f"{duration}",
        "-ar",
        str(sample_rate),
        "-ac",
        str(channels),
    ]

    for key, value in metadata:
        cmd.extend(["-metadata", f"{key}={value}"])

    cmd.append("-y" if force else "-n")
    cmd.append(str(output))
    return cmd


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate synthetic audio files via ffmpeg."
    )
    parser.add_argument(
        "output",
        type=Path,
        help="Path for the rendered audio (extension dictates format).",
    )
    parser.add_argument(
        "--waveform",
        choices=["sine", "square", "triangle", "saw", "noise"],
        default="sine",
    )
    parser.add_argument(
        "--duration", type=positive_float, default=5.0, help="Audio length in seconds."
    )
    parser.add_argument(
        "--frequency",
        type=positive_float,
        default=440.0,
        help="Fundamental frequency in Hz.",
    )
    parser.add_argument(
        "--partials",
        metavar="FREQ[:LEVEL]",
        action="append",
        default=[],
        help="Additional sine components (only for sine waveform). Repeatable.",
    )
    parser.add_argument(
        "--noise-color",
        choices=["white", "pink", "brown", "blue"],
        default="white",
        help="Color to use when waveform=noise.",
    )
    parser.add_argument(
        "--amplitude",
        type=amplitude_value,
        default=0.35,
        help="Overall output amplitude (0-1].",
    )
    parser.add_argument(
        "--sample-rate", type=positive_int, default=48000, help="Samples per second."
    )
    parser.add_argument(
        "--channels", type=positive_int, default=2, help="Number of output channels."
    )
    parser.add_argument(
        "--fade-in",
        type=non_negative_float,
        default=0.0,
        help="Apply fade-in of N seconds.",
    )
    parser.add_argument(
        "--fade-out",
        type=non_negative_float,
        default=0.0,
        help="Apply fade-out of N seconds.",
    )
    parser.add_argument(
        "--tag",
        metavar="KEY=VALUE",
        action="append",
        default=[],
        help="Optional metadata tags to embed. Repeatable.",
    )
    parser.add_argument(
        "--log-level",
        choices=LOG_LEVELS,
        default="warning",
        help="ffmpeg log verbosity.",
    )
    parser.add_argument(
        "--force", action="store_true", help="Overwrite output file if it exists."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the ffmpeg command without running it.",
    )

    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        parser.error("ffmpeg executable not found on PATH.")

    if args.fade_in + args.fade_out > args.duration:
        parser.error("sum of fade-in and fade-out cannot exceed total duration.")

    metadata = parse_tag_pairs(args.tag)

    partials = [parse_partial(p) for p in args.partials]
    try:
        if args.waveform == "noise":
            lavfi = build_noise_filtergraph(
                args.noise_color, args.duration, args.sample_rate, args.amplitude
            )
        else:
            lavfi = build_tone_filtergraph(
                args.waveform,
                args.frequency,
                args.duration,
                args.sample_rate,
                args.amplitude,
                partials,
            )
    except ValueError as exc:
        parser.error(str(exc))

    lavfi = apply_fades(lavfi, args.duration, args.fade_in, args.fade_out)

    if not args.output.parent.exists():
        args.output.parent.mkdir(parents=True, exist_ok=True)

    cmd = build_ffmpeg_command(
        lavfi,
        args.output,
        args.duration,
        args.sample_rate,
        args.channels,
        args.log_level,
        args.force,
        metadata,
    )

    if args.dry_run:
        print("ffmpeg command:")
        print("  " + shlex.join(cmd))
        return

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)


if __name__ == "__main__":
    main()
