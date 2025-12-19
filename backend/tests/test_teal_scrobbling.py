"""tests for teal.fm scrobbling integration."""

from backend._internal.atproto.teal import (
    build_teal_play_record,
    build_teal_status_record,
)
from backend._internal.auth import get_oauth_client
from backend.config import TealSettings, settings


class TestBuildTealPlayRecord:
    """tests for build_teal_play_record."""

    def test_builds_minimal_record(self):
        """should build record with required fields only."""
        record = build_teal_play_record(
            track_name="Test Track",
            artist_name="Test Artist",
        )

        assert record["$type"] == settings.teal.play_collection
        assert record["trackName"] == "Test Track"
        assert record["artists"] == [{"artistName": "Test Artist"}]
        assert record["musicServiceBaseDomain"] == "plyr.fm"
        assert record["submissionClientAgent"] == "plyr.fm/1.0"
        assert "playedTime" in record

    def test_includes_optional_fields(self):
        """should include optional fields when provided."""
        record = build_teal_play_record(
            track_name="Test Track",
            artist_name="Test Artist",
            duration=180,
            album_name="Test Album",
            origin_url="https://plyr.fm/track/123",
        )

        assert record["duration"] == 180
        assert record["releaseName"] == "Test Album"
        assert record["originUrl"] == "https://plyr.fm/track/123"


class TestBuildTealStatusRecord:
    """tests for build_teal_status_record."""

    def test_builds_status_record(self):
        """should build status record with item."""
        record = build_teal_status_record(
            track_name="Now Playing",
            artist_name="Cool Artist",
        )

        assert record["$type"] == settings.teal.status_collection
        assert "time" in record
        assert "expiry" in record
        assert "item" in record

        item = record["item"]
        assert item["trackName"] == "Now Playing"
        assert item["artists"] == [{"artistName": "Cool Artist"}]

    def test_expiry_is_after_time(self):
        """should set expiry after time."""
        record = build_teal_status_record(
            track_name="Test",
            artist_name="Test",
        )

        # expiry should be 10 minutes after time
        assert record["expiry"] > record["time"]


class TestTealSettings:
    """tests for teal.fm settings configuration."""

    def test_default_play_collection(self):
        """should have correct default teal play collection."""
        assert settings.teal.play_collection == "fm.teal.alpha.feed.play"

    def test_default_status_collection(self):
        """should have correct default teal status collection."""
        assert settings.teal.status_collection == "fm.teal.alpha.actor.status"

    def test_default_enabled(self):
        """should be enabled by default."""
        assert settings.teal.enabled is True

    def test_resolved_scope_with_teal(self):
        """should include teal scopes in extended scope."""
        scope = settings.atproto.resolved_scope_with_teal(
            settings.teal.play_collection, settings.teal.status_collection
        )

        assert "fm.teal.alpha.feed.play" in scope
        assert "fm.teal.alpha.actor.status" in scope
        # should also include base scopes
        assert settings.atproto.track_collection in scope

    def test_env_override_play_collection(self, monkeypatch):
        """should allow overriding play collection via environment variable.

        this proves we can adapt when teal.fm changes namespaces
        (e.g., from alpha to stable: fm.teal.feed.play).
        """
        monkeypatch.setenv("TEAL_PLAY_COLLECTION", "fm.teal.feed.play")

        # create fresh settings to pick up env var
        teal = TealSettings()
        assert teal.play_collection == "fm.teal.feed.play"

    def test_env_override_status_collection(self, monkeypatch):
        """should allow overriding status collection via environment variable."""
        monkeypatch.setenv("TEAL_STATUS_COLLECTION", "fm.teal.actor.status")

        teal = TealSettings()
        assert teal.status_collection == "fm.teal.actor.status"

    def test_env_override_enabled(self, monkeypatch):
        """should allow disabling teal integration via environment variable."""
        monkeypatch.setenv("TEAL_ENABLED", "false")

        teal = TealSettings()
        assert teal.enabled is False

    def test_scope_uses_configured_collections(self, monkeypatch):
        """should use configured collections in OAuth scope.

        when teal.fm graduates from alpha, we can update via env vars
        without code changes.
        """
        monkeypatch.setenv("TEAL_PLAY_COLLECTION", "fm.teal.feed.play")
        monkeypatch.setenv("TEAL_STATUS_COLLECTION", "fm.teal.actor.status")

        teal = TealSettings()
        scope = settings.atproto.resolved_scope_with_teal(
            teal.play_collection, teal.status_collection
        )

        assert "fm.teal.feed.play" in scope
        assert "fm.teal.actor.status" in scope
        # alpha namespaces should NOT be in scope when overridden
        assert "fm.teal.alpha.feed.play" not in scope
        assert "fm.teal.alpha.actor.status" not in scope


class TestOAuthClientWithTealScopes:
    """tests for OAuth client creation with teal scopes.

    verifies that get_oauth_client correctly includes teal scopes
    when include_teal=True - this is the core behavior for scope upgrade flows.
    """

    def test_oauth_client_without_teal(self):
        """OAuth client without teal should only have base plyr scopes."""
        client = get_oauth_client(include_teal=False)

        # should have plyr scopes
        assert settings.atproto.track_collection in client.scope
        assert settings.atproto.like_collection in client.scope

        # should NOT have teal scopes
        assert settings.teal.play_collection not in client.scope
        assert settings.teal.status_collection not in client.scope

    def test_oauth_client_with_teal(self):
        """OAuth client with teal should have both plyr and teal scopes."""
        client = get_oauth_client(include_teal=True)

        # should have plyr scopes
        assert settings.atproto.track_collection in client.scope
        assert settings.atproto.like_collection in client.scope

        # should ALSO have teal scopes
        assert settings.teal.play_collection in client.scope
        assert settings.teal.status_collection in client.scope

    def test_oauth_client_teal_scopes_are_repo_scopes(self):
        """teal scopes should be formatted as repo: scopes for OAuth."""
        client = get_oauth_client(include_teal=True)

        # verify scope format is correct for ATProto OAuth
        assert f"repo:{settings.teal.play_collection}" in client.scope
        assert f"repo:{settings.teal.status_collection}" in client.scope
