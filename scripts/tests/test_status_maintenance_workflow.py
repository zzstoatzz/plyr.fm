import unittest
from pathlib import Path

WORKFLOW = Path(__file__).parents[2] / ".github/workflows/status-maintenance.yml"


class StatusMaintenanceSecretBoundaryTests(unittest.TestCase):
    def test_google_key_is_scoped_to_deterministic_audio_step(self) -> None:
        workflow = WORKFLOW.read_text()
        claude_step = workflow.index("- uses: anthropics/claude-code-action@v1\n")
        audio_step = workflow.index("- name: Generate podcast audio\n")
        next_step = workflow.index("- name: Publish run outputs\n")

        self.assertNotIn("GOOGLE_API_KEY", workflow[claude_step:audio_step])
        self.assertEqual(
            workflow.count("GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}"), 1
        )
        self.assertIn("GOOGLE_API_KEY", workflow[audio_step:next_step])


if __name__ == "__main__":
    unittest.main()
