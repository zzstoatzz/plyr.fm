import base64
import importlib.util
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).parents[1] / "generate_tts.py"
SPEC = importlib.util.spec_from_file_location("generate_tts", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
generate_tts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generate_tts)


class ParseScriptTests(unittest.TestCase):
    def test_builds_structured_speaker_turns_without_spoken_labels(self) -> None:
        content = generate_tts.parse_script(
            "Host: First line.\nContinued thought.\n\nCohost: Reply.\n"
        )

        self.assertEqual(
            [turn["text"] for turn in content],
            ["First line.\nContinued thought.", "Reply."],
        )
        self.assertEqual(
            [turn["annotations"][0]["speaker"] for turn in content],
            ["Host", "Cohost"],
        )
        self.assertNotIn("Host:", str(content))
        self.assertNotIn("Cohost:", str(content))

    def test_rejects_unlabeled_opening_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "line 1"):
            generate_tts.parse_script("Welcome.\nHost: Hello.")

    def test_rejects_empty_turn(self) -> None:
        with self.assertRaisesRegex(ValueError, "Host turn must not be empty"):
            generate_tts.parse_script("Host:\nCohost: Hello.")


class DecodeWavTests(unittest.TestCase):
    def test_decodes_complete_wav_without_adding_another_header(self) -> None:
        wav = b"RIFF\x04\x00\x00\x00WAVE"
        self.assertEqual(generate_tts.decode_wav(base64.b64encode(wav).decode()), wav)

    def test_rejects_non_wav_audio(self) -> None:
        encoded = base64.b64encode(b"raw pcm data").decode()
        with self.assertRaisesRegex(ValueError, "not a WAV"):
            generate_tts.decode_wav(encoded)


if __name__ == "__main__":
    unittest.main()
