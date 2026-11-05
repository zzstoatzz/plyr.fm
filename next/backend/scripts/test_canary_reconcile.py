import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("canary_reconcile")
FAKE = r"""
import json, os, pathlib, sys, time
p = pathlib.Path(os.environ['FAKE_STATE'])
s = json.loads(p.read_text())
a = sys.argv[1:]
if pathlib.Path(sys.argv[0]).name == 'curl':
    print(json.dumps({'events':[{'type':'exit','request':{'exit_event':{'exit_code':s.get('exit',0)}}}]}))
elif a[:2] == ['machine','run']:
    name = a[a.index('--name')+1]
    s['machines'].append({'id':'abc123','name':name,'state':s.get('state','stopped'),'config':{'metadata':{'purpose':'zig-catalog-reconciliation'}}})
    p.write_text(json.dumps(s))
    print(os.environ['FLY_API_TOKEN'], flush=True)
    if s.get('create_fail'): sys.exit(17)
    print('Machine ID: abc123', flush=True)
elif a[:2] == ['machines','list']:
    if s.get('list_fail'): sys.exit(18)
    print(json.dumps(s['machines']))
elif a[:2] == ['machine','destroy']:
    s.setdefault('destroyed',[]).append(a[2])
    if not s.get('destroy_fail'): s['machines'] = [m for m in s['machines'] if m['id'] != a[2]]
    p.write_text(json.dumps(s))
    sys.exit(1 if s.get('destroy_fail') else 0)
elif a[0] == 'logs':
    print('worker logs')
else: sys.exit(99)
"""


class ReconcileProcessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.state = root / "state.json"
        self.state.write_text(json.dumps({"machines": []}))
        for name in ("flyctl", "curl"):
            executable = root / name
            executable.write_text(f"#!{sys.executable}\n" + FAKE)
            executable.chmod(0o700)
        self.env = dict(
            os.environ,
            PATH=f"{root}:{os.environ['PATH']}",
            FAKE_STATE=str(self.state),
            GITHUB_ACTIONS="true",
            GITHUB_REPOSITORY="zzstoatzz/plyr.fm",
            GITHUB_REF="refs/heads/main",
            GITHUB_RUN_ID="123",
            GITHUB_RUN_ATTEMPT="1",
            GITHUB_SHA="a" * 40,
            FLY_API_TOKEN="fixture-token",
            WORKER_DATABASE_URL="fixture-database",
            RECONCILE_TIMEOUT_SECONDS="1",
            RECONCILE_POLL_SECONDS="1",
            RUNNER_TEMP=str(root),
        )

    def configure(self, **values: object) -> None:
        state = json.loads(self.state.read_text())
        state.update(values)
        self.state.write_text(json.dumps(state))

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(SCRIPT), *args],
            env=self.env,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def assert_removed(self) -> None:
        state = json.loads(self.state.read_text())
        self.assertEqual(state["machines"], [])
        self.assertEqual(state["destroyed"], ["abc123"])

    def test_success_cleans_up_and_redacts(self) -> None:
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("fixture-token", result.stdout + result.stderr)
        self.assert_removed()

    def test_worker_failure_preserves_exit(self) -> None:
        self.configure(exit=7)
        self.assertEqual(self.run_script().returncode, 7)
        self.assert_removed()

    def test_timeout_cleans_up(self) -> None:
        self.configure(state="started")
        self.assertEqual(self.run_script().returncode, 124)
        self.assert_removed()

    def test_creation_failure_recovers_owned_machine(self) -> None:
        self.configure(create_fail=True)
        self.assertEqual(self.run_script().returncode, 17)
        self.assert_removed()

    def test_signal_cleans_up(self) -> None:
        self.configure(state="started")
        self.env["RECONCILE_TIMEOUT_SECONDS"] = "30"
        process = subprocess.Popen(
            [str(SCRIPT)],
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while not json.loads(self.state.read_text())["machines"]:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            process.send_signal(signal.SIGTERM)
            process.communicate(timeout=10)
            self.assertEqual(process.returncode, 143)
            self.assert_removed()
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_cleanup_failure_does_not_replace_worker_failure(self) -> None:
        self.configure(exit=7, destroy_fail=True)
        result = self.run_script()
        self.assertEqual(result.returncode, 7)
        self.assertIn("cleanup failed", result.stderr)

    def test_cleanup_only_does_not_touch_unrelated_machine(self) -> None:
        owned = {
            "id": "abc123",
            "name": "next-reconcile-123-1",
            "config": {"metadata": {"purpose": "zig-catalog-reconciliation"}},
        }
        unrelated = {"id": "def456", "name": "other", "config": {"metadata": {}}}
        self.configure(machines=[owned, unrelated])
        self.assertEqual(self.run_script("--cleanup-only").returncode, 0)
        state = json.loads(self.state.read_text())
        self.assertEqual(state["machines"], [unrelated])
        self.assertEqual(state["destroyed"], ["abc123"])

    def test_cleanup_inventory_failure_is_not_success(self) -> None:
        self.configure(list_fail=True)
        result = self.run_script("--cleanup-only")
        self.assertEqual(result.returncode, 1)
        self.assertIn("cleanup failed", result.stderr)

    def test_outside_ci_does_not_create_machine(self) -> None:
        self.env["GITHUB_REF"] = "refs/heads/other"
        self.assertEqual(self.run_script().returncode, 64)
        self.assertEqual(json.loads(self.state.read_text())["machines"], [])


if __name__ == "__main__":
    unittest.main()
