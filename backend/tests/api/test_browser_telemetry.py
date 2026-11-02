from fastapi.testclient import TestClient
from logfire.testing import CaptureLogfire


def test_browser_trace_forwarding_is_disabled_by_default(
    client: TestClient, capfire: CaptureLogfire
) -> None:
    response = client.post(
        "/logfire-proxy/v1/traces",
        content=b"browser telemetry batch",
        headers={"content-type": "application/x-protobuf"},
    )
    assert response.status_code == 204
    assert not capfire.exporter.exported_spans
