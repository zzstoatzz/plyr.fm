import pytest
from pydantic import ValidationError

from backend.api.meta import get_public_config
from backend.config import AppSettings, settings


async def test_upload_sponsor_threshold_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("UPLOAD_SPONSOR_THRESHOLD_HOURS", "0.01")
    configured = AppSettings()
    monkeypatch.setattr(
        settings.app,
        "upload_sponsor_threshold_hours",
        configured.upload_sponsor_threshold_hours,
    )
    assert (await get_public_config())["upload_sponsor_threshold_hours"] == 0.01


@pytest.mark.parametrize("value", ["-1", "nan", "inf"])
def test_upload_sponsor_threshold_rejects_invalid_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("UPLOAD_SPONSOR_THRESHOLD_HOURS", value)
    with pytest.raises(ValidationError):
        AppSettings()


def test_upload_sponsor_threshold_defaults_to_24(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("UPLOAD_SPONSOR_THRESHOLD_HOURS", raising=False)
    assert AppSettings(_env_file=None).upload_sponsor_threshold_hours == 24
