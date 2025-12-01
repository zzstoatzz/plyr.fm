#!/usr/bin/env python3
"""generate audio from a podcast script using gemini TTS.

usage:
    uv run scripts/generate_tts.py podcast_script.txt output.wav

requires GOOGLE_API_KEY environment variable.
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///

import io
import os
import sys
import wave
from pathlib import Path

from google import genai
from google.genai import types


def pcm_to_wav(
    pcm_data: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2
) -> bytes:
    """wrap raw PCM data in a WAV header."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(sample_width)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm_data)
    return buffer.getvalue()


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: generate_tts.py <script_file> <output_file>")
        sys.exit(1)

    script_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not script_path.exists():
        print(f"error: {script_path} not found")
        sys.exit(1)

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("error: GOOGLE_API_KEY not set")
        sys.exit(1)

    script = script_path.read_text()
    print(f"generating audio from {script_path} ({len(script)} chars)")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.5-flash-preview-tts",
        contents=script,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                    speaker_voice_configs=[
                        types.SpeakerVoiceConfig(
                            speaker="Host",
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                    voice_name="Kore"
                                )
                            ),
                        ),
                        types.SpeakerVoiceConfig(
                            speaker="Cohost",
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                    voice_name="Puck"
                                )
                            ),
                        ),
                    ]
                )
            ),
        ),
    )

    # gemini returns raw PCM (audio/L16;codec=pcm;rate=24000), wrap in WAV header
    pcm_data = response.candidates[0].content.parts[0].inline_data.data
    wav_data = pcm_to_wav(pcm_data)
    output_path.write_bytes(wav_data)
    print(f"saved audio to {output_path} ({len(wav_data)} bytes)")


if __name__ == "__main__":
    main()
