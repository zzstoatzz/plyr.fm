import importlib.util
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

SCRIPT_PATH = Path(__file__).parents[1] / "generate_tts_local.py"
SPEC = importlib.util.spec_from_file_location("generate_tts_local", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
generate_tts_local = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generate_tts_local)


class ParseTurnsTests(unittest.TestCase):
    def test_reads_the_same_script_format_as_the_gemini_renderer(self) -> None:
        turns = generate_tts_local.parse_turns(
            "Host: First line.\nContinued thought.\n\nCohost: Reply.\n"
        )
        self.assertEqual(
            turns, [("Host", "First line. Continued thought."), ("Cohost", "Reply.")]
        )

    def test_rejects_unlabeled_opening_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "line 1"):
            generate_tts_local.parse_turns("Welcome.\nHost: Hello.")

    def test_rejects_empty_turn(self) -> None:
        with self.assertRaisesRegex(ValueError, "Host turn must not be empty"):
            generate_tts_local.parse_turns("Host:\nCohost: Hello.")

    def test_every_speaker_has_a_voice(self) -> None:
        self.assertEqual(set(generate_tts_local.VOICES), {"Host", "Cohost"})


class ModelFileTests(unittest.TestCase):
    def test_a_file_with_the_wrong_hash_is_refused_and_removed(self) -> None:
        with TemporaryDirectory() as directory:
            for name in generate_tts_local.FILES:
                (Path(directory) / name).write_bytes(b"not the model")
            with self.assertRaisesRegex(RuntimeError, "expected"):
                generate_tts_local.fetch_model(Path(directory))
            self.assertFalse((Path(directory) / "kokoro-v1.0.onnx").exists())

    def test_hashes_are_pinned(self) -> None:
        for digest in generate_tts_local.FILES.values():
            self.assertRegex(digest, r"^[0-9a-f]{64}$")


class WavTests(unittest.TestCase):
    def test_pcm_is_16_bit_little_endian(self) -> None:
        self.assertEqual(
            generate_tts_local.to_pcm16([0.0, 1.0, -1.0, 2.0]),
            b"\x00\x00\xff\x7f\x01\x80\xff\x7f",
        )

    def test_wave_module_reads_what_would_be_written(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "out.wav"
            with wave.open(str(path), "wb") as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(24000)
                out.writeframes(generate_tts_local.to_pcm16([0.0] * 24000))
            with wave.open(str(path), "rb") as read:
                self.assertEqual(
                    (read.getframerate(), read.getnframes()), (24000, 24000)
                )


if __name__ == "__main__":
    unittest.main()
