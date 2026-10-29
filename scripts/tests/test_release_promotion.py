import os
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path

PROMOTE = runpy.run_path(str(Path(__file__).parents[1] / "release"))[
    "production_promotion"
]


class ReleasePromotionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(os.chdir, self.previous)
        os.chdir(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        self.base = self.commit("base")
        self.git("update-ref", "refs/remotes/origin/production-fe", self.base)

    def git(self, *args: str) -> str:
        return subprocess.check_output(["git", *args], text=True).strip()

    def commit(self, content: str) -> str:
        Path("app").write_text(content)
        self.git("add", "app")
        self.git("commit", "-qm", content)
        return self.git("rev-parse", "HEAD")

    def diverge(self) -> tuple[str, str]:
        production = self.commit("production hotfix")
        self.git("update-ref", "refs/remotes/origin/production-fe", production)
        self.git("checkout", "-q", "--detach", self.base)
        target = self.commit("reviewed main including hotfix")
        return production, target

    def test_fast_forward_uses_target(self) -> None:
        target = self.commit("new feature")
        self.assertEqual(PROMOTE(target), target)

    def test_divergence_requires_explicit_reconciliation(self) -> None:
        production, target = self.diverge()
        with self.assertRaisesRegex(RuntimeError, "divergent history"):
            PROMOTE(target)
        self.assertEqual(self.git("rev-parse", "origin/production-fe"), production)

    def test_reconciliation_preserves_history_and_exact_reviewed_tree(self) -> None:
        production, target = self.diverge()
        promotion = PROMOTE(target, reconcile=True)
        self.assertEqual(
            self.git("rev-parse", f"{promotion}^{{tree}}"),
            self.git("rev-parse", f"{target}^{{tree}}"),
        )
        self.assertEqual(self.git("rev-parse", f"{promotion}^1"), production)
        self.assertEqual(self.git("rev-parse", f"{promotion}^2"), target)
        self.git("init", "-q", "--bare", "remote.git")
        self.git("push", "-q", "remote.git", f"{production}:refs/heads/production-fe")
        self.git("push", "-q", "remote.git", f"{promotion}:refs/heads/production-fe")
        self.git("checkout", "-q", "--detach", promotion)
        concurrent = self.commit("another production hotfix")
        self.git("push", "-q", "remote.git", f"{concurrent}:refs/heads/production-fe")
        result = subprocess.run(
            [
                "git",
                "push",
                "-q",
                "remote.git",
                f"{promotion}:refs/heads/production-fe",
            ],
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            self.git("--git-dir=remote.git", "rev-parse", "production-fe"), concurrent
        )


if __name__ == "__main__":
    unittest.main()
