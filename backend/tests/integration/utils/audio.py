"""pure python audio generation for integration tests.

generates simple drone sounds (sine waves) without external dependencies.
these are useful for testing upload/streaming without needing FFmpeg.
"""

import math
import struct
from io import BytesIO
from pathlib import Path

# standard musical note frequencies (A440 tuning)
NOTE_FREQUENCIES: dict[str, float] = {
    "C3": 130.81,
    "D3": 146.83,
    "E3": 164.81,
    "F3": 174.61,
    "G3": 196.00,
    "A3": 220.00,
    "B3": 246.94,
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "F4": 349.23,
    "G4": 392.00,
    "A4": 440.00,
    "B4": 493.88,
    "C5": 523.25,
    "A5": 880.00,
}


def note_to_freq(note: str) -> float:
    """convert note name to frequency.

    args:
        note: note name like 'A4', 'C3', etc.

    returns:
        frequency in Hz

    raises:
        ValueError: if note is not recognized
    """
    if note not in NOTE_FREQUENCIES:
        valid = ", ".join(sorted(NOTE_FREQUENCIES.keys()))
        msg = f"unknown note: {note}. valid notes: {valid}"
        raise ValueError(msg)
    return NOTE_FREQUENCIES[note]


def generate_drone(
    note: str = "A4",
    duration_sec: float = 2.0,
    sample_rate: int = 22050,
    amplitude: float = 0.3,
) -> BytesIO:
    """generate a pure sine wave drone as WAV audio.

    creates a simple tone at the specified musical note frequency.
    includes fade in/out to avoid clicks at start/end.

    args:
        note: musical note name (e.g., 'A4' for 440Hz). see NOTE_FREQUENCIES.
        duration_sec: duration in seconds
        sample_rate: samples per second (lower = smaller file)
        amplitude: volume from 0.0 to 1.0

    returns:
        BytesIO containing valid WAV file data

    example:
        >>> wav = generate_drone("A4", duration_sec=2.0)
        >>> Path("/tmp/drone.wav").write_bytes(wav.read())
    """
    freq = note_to_freq(note)
    num_samples = int(sample_rate * duration_sec)

    # generate sine wave with fade envelope
    samples = []
    for i in range(num_samples):
        t = i / sample_rate
        # fade in first 0.1s, fade out last 0.1s to avoid clicks
        fade_in = min(t / 0.1, 1.0)
        fade_out = min((duration_sec - t) / 0.1, 1.0)
        envelope = fade_in * fade_out

        # generate sample
        sample_value = amplitude * envelope * math.sin(2 * math.pi * freq * t)
        # convert to 16-bit signed integer
        sample_int = int(32767 * max(-1.0, min(1.0, sample_value)))
        samples.append(struct.pack("<h", sample_int))

    audio_data = b"".join(samples)

    # build WAV file
    wav = BytesIO()

    # RIFF header
    wav.write(b"RIFF")
    wav.write(struct.pack("<I", 36 + len(audio_data)))  # file size - 8
    wav.write(b"WAVE")

    # fmt chunk
    wav.write(b"fmt ")
    wav.write(
        struct.pack(
            "<IHHIIHH",
            16,  # chunk size
            1,  # audio format (PCM)
            1,  # num channels (mono)
            sample_rate,
            sample_rate * 2,  # byte rate (sample_rate * channels * bytes_per_sample)
            2,  # block align (channels * bytes_per_sample)
            16,  # bits per sample
        )
    )

    # data chunk
    wav.write(b"data")
    wav.write(struct.pack("<I", len(audio_data)))
    wav.write(audio_data)

    wav.seek(0)
    return wav


def save_drone(
    path: Path,
    note: str = "A4",
    duration_sec: float = 2.0,
) -> Path:
    """generate and save a drone to a file.

    convenience wrapper around generate_drone.

    args:
        path: where to save the WAV file
        note: musical note name
        duration_sec: duration in seconds

    returns:
        the path where the file was saved
    """
    wav = generate_drone(note, duration_sec)
    path.write_bytes(wav.read())
    return path


def convert_to_format(
    wav_path: Path,
    output_path: Path,
) -> Path:
    """convert a WAV file to another format using ffmpeg.

    args:
        wav_path: source WAV file
        output_path: destination path (format inferred from extension)

    returns:
        the output path

    raises:
        FileNotFoundError: if ffmpeg is not available
        subprocess.CalledProcessError: if conversion fails
    """
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        msg = "ffmpeg not found - required for lossless format tests"
        raise FileNotFoundError(msg)

    subprocess.run(
        ["ffmpeg", "-y", "-i", str(wav_path), str(output_path)],
        check=True,
        capture_output=True,
    )
    return output_path


def save_drone_as(
    path: Path,
    note: str = "A4",
    duration_sec: float = 2.0,
) -> Path:
    """generate a drone and save in any supported format.

    generates WAV first, then converts to target format if needed.
    supports: .wav, .flac, .aiff, .aif

    args:
        path: where to save the file (format from extension)
        note: musical note name
        duration_sec: duration in seconds

    returns:
        the path where the file was saved
    """
    suffix = path.suffix.lower()

    if suffix == ".wav":
        return save_drone(path, note, duration_sec)

    # generate WAV first, then convert
    wav_path = path.with_suffix(".wav")
    save_drone(wav_path, note, duration_sec)

    try:
        convert_to_format(wav_path, path)
    finally:
        wav_path.unlink(missing_ok=True)

    return path
