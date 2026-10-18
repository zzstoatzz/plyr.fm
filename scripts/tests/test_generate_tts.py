import base64
import importlib.util
import io
import unittest
import wave
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

    def test_delivery_note_joins_the_speaker_style_and_is_not_spoken(self) -> None:
        content = generate_tts.parse_script("Cohost [laughing]: Really?\n")

        self.assertEqual(content[0]["text"], "Really?")
        style = content[0]["annotations"][0]["style"]
        self.assertTrue(style.startswith(generate_tts.DIRECTION))
        self.assertIn(generate_tts.SPEAKERS["Cohost"]["style"], style)
        self.assertTrue(style.endswith("for this line: laughing"))

    def test_no_direction_leaves_the_speaker_style_alone(self) -> None:
        content = generate_tts.parse_script("Host: Hi.\n", direction=None)

        self.assertEqual(
            content[0]["annotations"][0]["style"],
            generate_tts.SPEAKERS["Host"]["style"],
        )


class ChunkTurnsTests(unittest.TestCase):
    def test_splits_at_turn_boundaries_under_the_word_budget(self) -> None:
        content = generate_tts.parse_script(
            "Host: one two three\nCohost: four five\nHost: six seven eight\n"
        )

        chunks = generate_tts.chunk_turns(content, max_words=5)

        self.assertEqual([len(chunk) for chunk in chunks], [2, 1])


class DecodeWavTests(unittest.TestCase):
    def test_decodes_complete_wav_without_adding_another_header(self) -> None:
        wav = b"RIFF\x04\x00\x00\x00WAVE"
        self.assertEqual(generate_tts.decode_wav(base64.b64encode(wav).decode()), wav)

    def test_rejects_non_wav_audio(self) -> None:
        encoded = base64.b64encode(b"raw pcm data").decode()
        with self.assertRaisesRegex(ValueError, "not a WAV"):
            generate_tts.decode_wav(encoded)


class JoinWavsTests(unittest.TestCase):
    def test_concatenates_frames_under_one_header(self) -> None:
        def wav(frames: bytes) -> bytes:
            out = io.BytesIO()
            with wave.open(out, "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(24000)
                writer.writeframes(frames)
            return out.getvalue()

        joined = generate_tts.join_wavs([wav(b"\x01\x00"), wav(b"\x02\x00")])

        with wave.open(io.BytesIO(joined)) as reader:
            self.assertEqual(
                reader.readframes(reader.getnframes()), b"\x01\x00\x02\x00"
            )


if __name__ == "__main__":
    unittest.main()
