"""tests for playlist track recommendation logic."""

from unittest.mock import AsyncMock, patch

from backend._internal.clients.tpuf import VectorSearchResult
from backend._internal.recommendations import (
    _kmeans,
    get_playlist_recommendations,
    rrf_merge,
)

# --- rrf_merge tests ---


def test_rrf_merge_single_list() -> None:
    """rrf_merge with a single list just filters excluded IDs."""
    results = [
        VectorSearchResult(track_id=1, distance=0.1),
        VectorSearchResult(track_id=2, distance=0.2),
        VectorSearchResult(track_id=3, distance=0.3),
    ]
    merged = rrf_merge([results], exclude_ids={2})

    assert [r.track_id for r in merged] == [1, 3]


def test_rrf_merge_multiple_lists() -> None:
    """rrf_merge combines rankings — tracks appearing in multiple lists rank higher."""
    list_a = [
        VectorSearchResult(track_id=10, distance=0.1),
        VectorSearchResult(track_id=20, distance=0.2),
        VectorSearchResult(track_id=30, distance=0.3),
    ]
    list_b = [
        VectorSearchResult(track_id=20, distance=0.15),
        VectorSearchResult(track_id=40, distance=0.25),
        VectorSearchResult(track_id=10, distance=0.35),
    ]

    merged = rrf_merge([list_a, list_b], exclude_ids=set())

    # track 20 and 10 appear in both lists so should rank highest
    ids = [r.track_id for r in merged]
    assert 20 in ids[:2]
    assert 10 in ids[:2]
    assert len(ids) == 4  # 10, 20, 30, 40


def test_rrf_merge_excludes_playlist_tracks() -> None:
    """tracks in exclude_ids are not in the result."""
    results = [
        VectorSearchResult(track_id=1, distance=0.1),
        VectorSearchResult(track_id=2, distance=0.2),
    ]
    merged = rrf_merge([results], exclude_ids={1, 2})
    assert merged == []


def test_rrf_merge_empty_lists() -> None:
    """rrf_merge with empty input returns empty."""
    assert rrf_merge([], exclude_ids=set()) == []
    assert rrf_merge([[]], exclude_ids=set()) == []


def test_rrf_merge_keeps_best_distance() -> None:
    """when a track appears in multiple lists, keep the best (lowest) distance."""
    list_a = [VectorSearchResult(track_id=1, distance=0.5)]
    list_b = [VectorSearchResult(track_id=1, distance=0.2)]

    merged = rrf_merge([list_a, list_b], exclude_ids=set())
    assert len(merged) == 1
    assert merged[0].distance == 0.2


# --- k-means tests ---


def test_kmeans_basic() -> None:
    """k-means produces correct number of centroids and finds clusters."""
    # two clusters: around [0,0] and [10,10]
    vectors: list[list[float]] = [
        [0.0, 0.1],
        [0.1, 0.0],
        [-0.1, 0.0],
        [10.0, 10.1],
        [10.1, 10.0],
        [9.9, 10.0],
    ]
    centroids = _kmeans(vectors, k=2)
    assert len(centroids) == 2
    assert len(centroids[0]) == 2

    # centroids should be near [0,0] and [10,10]
    centroid_sorted = sorted(centroids, key=lambda c: c[0])
    assert abs(centroid_sorted[0][0]) < 1.0
    assert abs(centroid_sorted[1][0] - 10.0) < 1.0


def test_kmeans_single_cluster() -> None:
    """k-means with k=1 returns the mean."""
    vectors: list[list[float]] = [[1.0, 2.0], [3.0, 4.0]]
    centroids = _kmeans(vectors, k=1)
    assert len(centroids) == 1
    assert abs(centroids[0][0] - 2.0) < 1e-6
    assert abs(centroids[0][1] - 3.0) < 1e-6


# --- adaptive strategy tests ---


@patch("backend._internal.recommendations.get_vectors")
@patch("backend._internal.recommendations.query")
async def test_single_track_strategy(
    mock_query: AsyncMock, mock_get_vectors: AsyncMock
) -> None:
    """1 track: queries turbopuffer directly with the track's embedding."""
    mock_get_vectors.return_value = {1: [0.1] * 512}
    mock_query.return_value = [
        VectorSearchResult(track_id=99, distance=0.1),
        VectorSearchResult(track_id=1, distance=0.0),  # should be excluded
    ]

    results = await get_playlist_recommendations([1], limit=3)

    mock_query.assert_called_once()
    assert len(results) == 1
    assert results[0].track_id == 99


@patch("backend._internal.recommendations.get_vectors")
@patch("backend._internal.recommendations.query")
async def test_multi_track_rrf_strategy(
    mock_query: AsyncMock, mock_get_vectors: AsyncMock
) -> None:
    """2-5 tracks: queries each embedding, merges with RRF."""
    mock_get_vectors.return_value = {
        1: [0.1] * 512,
        2: [0.2] * 512,
        3: [0.3] * 512,
    }
    mock_query.return_value = [
        VectorSearchResult(track_id=99, distance=0.1),
        VectorSearchResult(track_id=98, distance=0.2),
    ]

    results = await get_playlist_recommendations([1, 2, 3], limit=3)

    # should have queried 3 times (one per track)
    assert mock_query.call_count == 3
    assert all(r.track_id not in {1, 2, 3} for r in results)


@patch("backend._internal.recommendations.get_vectors")
@patch("backend._internal.recommendations.query")
async def test_large_playlist_kmeans_strategy(
    mock_query: AsyncMock, mock_get_vectors: AsyncMock
) -> None:
    """6+ tracks: clusters into centroids, queries each centroid."""
    # 8 tracks -> min(3, 8//2) = 3 clusters
    vecs = {i: [float(i) / 10] * 512 for i in range(1, 9)}
    mock_get_vectors.return_value = vecs
    mock_query.return_value = [
        VectorSearchResult(track_id=99, distance=0.1),
    ]

    results = await get_playlist_recommendations(list(range(1, 9)), limit=3)

    # should have queried 3 times (one per cluster centroid)
    assert mock_query.call_count == 3
    assert all(r.track_id not in set(range(1, 9)) for r in results)


@patch("backend._internal.recommendations.get_vectors")
async def test_empty_playlist_returns_empty(mock_get_vectors: AsyncMock) -> None:
    """empty playlist returns empty recommendations."""
    results = await get_playlist_recommendations([], limit=3)
    assert results == []
    mock_get_vectors.assert_not_called()


@patch("backend._internal.recommendations.get_vectors")
async def test_no_embeddings_returns_empty(mock_get_vectors: AsyncMock) -> None:
    """playlist with no embedded tracks returns empty."""
    mock_get_vectors.return_value = {}
    results = await get_playlist_recommendations([1, 2], limit=3)
    assert results == []
