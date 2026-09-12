import subprocess
import sys
from pathlib import Path

import pytest

import compose
from studio.render_process import RenderError, run_renderer


def test_python_traceback_is_retained() -> None:
    with pytest.raises(
        RenderError, match="NameError: name 'missing_voice' is not defined"
    ):
        run_renderer([sys.executable, "-c", "missing_voice()"])


def test_large_stderr_is_drained_with_bounded_retention() -> None:
    with pytest.raises(RenderError) as raised:
        run_renderer(
            [
                sys.executable,
                "-c",
                "import sys; sys.stderr.write('x'*1000000+'THE END'); sys.exit(1)",
            ]
        )
    assert len(raised.value.stderr) == 8192
    assert raised.value.stderr.endswith("THE END")


def test_timeout_retains_diagnostics() -> None:
    with pytest.raises(RenderError, match="timed out: started"):
        run_renderer(
            [
                sys.executable,
                "-c",
                "import sys,time; print('started',file=sys.stderr,flush=True); time.sleep(10)",
            ],
            timeout=0.5,
        )


def test_successful_renderer_stderr_does_not_fail() -> None:
    run_renderer([sys.executable, "-c", "import sys; print('warning',file=sys.stderr)"])


def test_render_retains_error_artifact_and_removes_container(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = subprocess.Popen
    commands: list[list[str]] = []

    def launch(command: list[str], **kwargs: object) -> subprocess.Popen:
        commands.append(command)
        source = "missing_voice()" if command[1] == "run" else "pass"
        return original([sys.executable, "-c", source], **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    with pytest.raises(RenderError, match="NameError"):
        compose.render("fixture", tmp_path)
    assert "NameError" in (tmp_path / "render-error.txt").read_text()
    assert commands[-1][:3] == ["docker", "rm", "-f"]
    assert commands[0][commands[0].index("--network") + 1] == "none"
