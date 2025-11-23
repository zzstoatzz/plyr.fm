import pytest

from backend.config import StorageSettings


@pytest.fixture
def storage_settings(monkeypatch: pytest.MonkeyPatch) -> StorageSettings:
    """fixture for storage settings with R2 image bucket configured."""
    monkeypatch.setenv(
        "R2_PUBLIC_IMAGE_BUCKET_URL", "https://images.example.com/bucket"
    )
    return StorageSettings()


def test_validate_image_url_allows_none(storage_settings: StorageSettings) -> None:
    """validate that None/empty imageUrl is allowed."""
    assert storage_settings.validate_image_url(None) is True
    assert storage_settings.validate_image_url("") is True


def test_validate_image_url_allows_trusted_origin(
    storage_settings: StorageSettings,
) -> None:
    """validate that imageUrl from allowed origin passes."""
    url = "https://images.example.com/bucket/track123.jpg"
    assert storage_settings.validate_image_url(url) is True


def test_validate_image_url_rejects_external_origin(
    storage_settings: StorageSettings,
) -> None:
    """validate that imageUrl from external origin is rejected."""
    url = "https://malicious.com/bad-image.jpg"

    with pytest.raises(ValueError, match="image must be hosted on allowed origins"):
        storage_settings.validate_image_url(url)


def test_validate_image_url_rejects_subdomain_mismatch(
    storage_settings: StorageSettings,
) -> None:
    """validate that subdomains are not automatically trusted."""
    url = "https://evil.images.example.com/fake.jpg"

    with pytest.raises(ValueError, match="image must be hosted on allowed origins"):
        storage_settings.validate_image_url(url)


def test_validate_image_url_respects_scheme(storage_settings: StorageSettings) -> None:
    """validate that scheme (http vs https) is enforced."""
    url = "http://images.example.com/bucket/track123.jpg"

    with pytest.raises(ValueError, match="image must be hosted on allowed origins"):
        storage_settings.validate_image_url(url)


def test_allowed_image_origins_empty_when_no_bucket_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """validate that allowed_image_origins is empty without R2 config."""
    monkeypatch.setenv("R2_PUBLIC_IMAGE_BUCKET_URL", "")
    settings = StorageSettings()
    assert settings.allowed_image_origins == set()


def test_allowed_image_origins_extracts_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """validate that allowed_image_origins correctly extracts scheme+netloc."""
    monkeypatch.setenv(
        "R2_PUBLIC_IMAGE_BUCKET_URL", "https://cdn.example.com/my-bucket/path"
    )
    settings = StorageSettings()
    assert settings.allowed_image_origins == {"https://cdn.example.com"}
