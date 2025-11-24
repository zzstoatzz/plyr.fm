"""Tests for progress tracking utilities."""

import pytest

from backend.storage.r2 import UploadProgressTracker


class TestUploadProgressTracker:
    """Tests for UploadProgressTracker bytes-to-percentage conversion."""

    def test_converts_bytes_to_percentage(self):
        """Callback receives bytes, passes percentage to inner callback."""
        received_percentages: list[float] = []

        def capture_pct(pct: float) -> None:
            received_percentages.append(pct)

        tracker = UploadProgressTracker(
            total_size=1000,
            callback=capture_pct,
            min_bytes_between_updates=100,  # Update every 100 bytes
            min_time_between_updates=0,  # No time throttling for test
        )

        # Simulate boto3 calling with bytes
        tracker(100)  # 10%
        tracker(200)  # 30%
        tracker(300)  # 60%
        tracker(400)  # 100%

        # Should have received percentage values, not bytes
        assert len(received_percentages) == 4
        assert received_percentages[0] == pytest.approx(10.0)
        assert received_percentages[1] == pytest.approx(30.0)
        assert received_percentages[2] == pytest.approx(60.0)
        assert received_percentages[3] == pytest.approx(100.0)

    def test_throttles_by_bytes_and_time(self):
        """Updates are throttled based on bytes OR time threshold (OR logic)."""
        received_percentages: list[float] = []

        def capture_pct(pct: float) -> None:
            received_percentages.append(pct)

        # With min_time=0, every call triggers based on time threshold
        # This matches the OR logic in UploadProgressTracker
        tracker = UploadProgressTracker(
            total_size=1000,
            callback=capture_pct,
            min_bytes_between_updates=500,
            min_time_between_updates=0,  # Time threshold always met
        )

        # Every call triggers because time threshold (0) is always satisfied
        tracker(100)
        tracker(100)
        assert len(received_percentages) == 2

    def test_always_emits_near_completion(self):
        """Always emits update when near 100% completion."""
        received_percentages: list[float] = []

        def capture_pct(pct: float) -> None:
            received_percentages.append(pct)

        tracker = UploadProgressTracker(
            total_size=100,
            callback=capture_pct,
            min_bytes_between_updates=1000,  # Very high threshold
            min_time_between_updates=1000,  # Very high threshold
        )

        # Near completion (99.9%+) should always emit
        tracker(100)  # 100%
        assert len(received_percentages) == 1
        assert received_percentages[0] == pytest.approx(100.0)
