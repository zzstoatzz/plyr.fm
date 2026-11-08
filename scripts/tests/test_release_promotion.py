import os
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PROMOTE = runpy.run_path(str(Path(__file__).parents[1] / "release"))[
    "production_promotion"
]
# hooks and `rebase --exec` export these; inherited, they aim the fixture's git at this checkout
GIT_LOCATION_VARIABLES = (
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PREFIX",
    "GIT_WORK_TREE",
)


def isolate_git(test: unittest.TestCase) -> None:
    test.enterContext(mock.patch.dict(os.environ))
    for name in GIT_LOCATION_VARIABLES:
        os.environ.pop(name, None)


def git_config(git_dir: Path, key: str) -> str | None:
    result = subprocess.run(
        ["git", "config", "--file", str(git_dir / "config"), "--get", key],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def git_head(git_dir: Path) -> str:
    return subprocess.check_output(
        ["git", "--git-dir", str(git_dir), "rev-parse", "HEAD"], text=True
    ).strip()


class ReleasePromotionTests(unittest.TestCase):
    def setUp(self) -> None:
        isolate_git(self)
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


class GitIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        isolate_git(self)

    def test_fixture_repos_ignore_an_inherited_git_dir(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        sentinel = Path(temp.name) / "sentinel"
        subprocess.run(["git", "init", "-q", str(sentinel)], check=True)
        subprocess.run(
            ["git", "-C", str(sentinel), "-c", "user.name=s", "-c", "user.email=s@s"]
            + ["commit", "--allow-empty", "-qm", "sentinel"],
            check=True,
        )
        git_dir = sentinel / ".git"
        head = git_head(git_dir)

        result = subprocess.run(
            [sys.executable, "-m", "unittest", "-q"]
            + ["test_release_promotion.ReleasePromotionTests"],
            cwd=Path(__file__).parent,
            env={**os.environ, "GIT_DIR": str(git_dir)},
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(git_config(git_dir, "core.bare"), "false")
        self.assertIsNone(git_config(git_dir, "user.email"))
        self.assertEqual(git_head(git_dir), head)


if __name__ == "__main__":
    unittest.main()
