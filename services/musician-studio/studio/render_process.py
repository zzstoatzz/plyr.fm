"""Keep bounded diagnostics from the isolated audio renderer."""

import os
import selectors
import subprocess
import time


class RenderError(RuntimeError):
    def __init__(self, reason: str, stderr: str) -> None:
        self.reason = reason
        self.stderr = stderr
        super().__init__(reason, stderr)

    def __str__(self) -> str:
        return f"Audio render {self.reason}: {self.stderr or 'no stderr emitted'}"


def run_renderer(command: list[str], timeout: float = 30) -> None:
    tail = bytearray()
    with subprocess.Popen(
        command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    ) as process:
        assert process.stderr is not None
        os.set_blocking(process.stderr.fileno(), False)
        deadline = time.monotonic() + timeout
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stderr, selectors.EVENT_READ)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise RenderError("timed out", tail.decode(errors="replace"))
                    for key, _ in selector.select(min(remaining, 0.1)):
                        chunk = os.read(key.fd, 4096)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            tail.extend(chunk)
                            del tail[:-8192]
            try:
                code = process.wait(timeout=max(0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise RenderError("timed out", tail.decode(errors="replace")) from None
            if code:
                raise RenderError(f"exited {code}", tail.decode(errors="replace"))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
