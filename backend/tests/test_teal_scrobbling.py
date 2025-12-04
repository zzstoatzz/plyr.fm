"""tests for teal.fm scrobbling integration."""

import pytest

from backend._internal.atproto.teal import (
    build_teal_play_record,
    build_teal_status_record,
)
from backend.config import settings


class TestBuildTealPlayRecord:
    """tests for build_teal_play_record."""

    def test_builds_minimal_record(self):
        """should build record with required fields only."""
        record = build_teal_play_record(
            track_name="Test Track",
            artist_name="Test Artist",
        )

        assert record["$type"] == settings.atproto.teal_play_collection
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

        assert record["$type"] == settings.atproto.teal_status_collection
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


class TestTealScopeConfig:
    """tests for teal scope configuration."""

    def test_teal_play_collection(self):
        """should have correct teal play collection."""
        assert settings.atproto.teal_play_collection == "fm.teal.alpha.feed.play"

    def test_teal_status_collection(self):
        """should have correct teal status collection."""
        assert settings.atproto.teal_status_collection == "fm.teal.alpha.actor.status"

    def test_resolved_scope_with_teal(self):
        """should include teal scopes in extended scope."""
        scope = settings.atproto.resolved_scope_with_teal

        assert "fm.teal.alpha.feed.play" in scope
        assert "fm.teal.alpha.actor.status" in scope
        # should also include base scopes
        assert settings.atproto.track_collection in scope
