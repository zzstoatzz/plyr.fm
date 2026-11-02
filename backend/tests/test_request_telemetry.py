import logfire
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from logfire.testing import CaptureLogfire

from backend.utilities.observability import configure_request_tracing


@pytest.mark.parametrize("fails", [False, True])
def test_polling_and_trace_forwarding_do_not_generate_request_spans(
    capfire: CaptureLogfire, fails: bool
) -> None:
    app = FastAPI()

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/logfire-proxy/{path:path}")
    def forward(path: str) -> dict[str, str]:
        return {"path": path}

    @app.get("/work")
    def work() -> dict[str, bool]:
        if fails:
            raise RuntimeError("operation failed")
        return {"ok": True}

    configure_request_tracing(app, logfire)
    with TestClient(app, raise_server_exceptions=False) as client:
        for _ in range(20):
            assert client.get("/health").status_code == 200
            assert client.post("/logfire-proxy/v1/traces").status_code == 200
        assert client.get("/work").status_code == (500 if fails else 200)

    spans = capfire.exporter.exported_spans_as_dict()
    names = [span["name"] for span in spans]
    assert not any("/health" in name or "/logfire-proxy" in name for name in names)
    assert "GET /work" in names
    assert any(span.get("events") for span in spans) == fails
