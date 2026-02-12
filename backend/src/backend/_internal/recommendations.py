"""playlist track recommendations using CLAP embeddings.

computes recommendations by querying turbopuffer for tracks similar
to those already in a playlist. uses adaptive strategy based on
playlist size: direct query (1 track), per-track query with RRF merge
(2-5 tracks), or k-means clustered centroids with RRF merge (6+).
"""

import asyncio
import logging
import random

from backend._internal.clients.tpuf import VectorSearchResult, get_vectors, query

logger = logging.getLogger(__name__)

# type alias for embedding vectors
Vector = list[float]


def rrf_merge(
    ranked_lists: list[list[VectorSearchResult]],
    exclude_ids: set[int],
    k: int = 60,
) -> list[VectorSearchResult]:
    """merge multiple ranked result lists using Reciprocal Rank Fusion.

    args:
        ranked_lists: list of ranked result lists from separate queries
        exclude_ids: track IDs to exclude (already in playlist)
        k: RRF constant (default 60, standard value)

    returns:
        merged results sorted by combined RRF score, descending
    """
    scores: dict[int, float] = {}
    best_result: dict[int, VectorSearchResult] = {}

    for results in ranked_lists:
        for rank, result in enumerate(results):
            if result.track_id in exclude_ids:
                continue
            scores[result.track_id] = scores.get(result.track_id, 0.0) + 1.0 / (
                k + rank + 1
            )
            # keep the result with best distance
            if result.track_id not in best_result or (
                result.distance < best_result[result.track_id].distance
            ):
                best_result[result.track_id] = result

    # sort by RRF score descending
    sorted_ids = sorted(scores.keys(), key=lambda tid: scores[tid], reverse=True)
    return [best_result[tid] for tid in sorted_ids]


def _squared_distance(a: Vector, b: Vector) -> float:
    """squared euclidean distance between two vectors."""
    return sum((x - y) ** 2 for x, y in zip(a, b, strict=True))


def _vec_add(a: Vector, b: Vector) -> Vector:
    """element-wise addition of two vectors."""
    return [x + y for x, y in zip(a, b, strict=True)]


def _vec_scale(v: Vector, s: float) -> Vector:
    """scale a vector by a scalar."""
    return [x * s for x in v]


def _kmeans(vectors: list[Vector], k: int, max_iter: int = 20) -> list[Vector]:
    """simple k-means clustering using pure python.

    operates on small inputs (N<=20 vectors of 512 dims).

    args:
        vectors: list of N vectors
        k: number of clusters
        max_iter: maximum iterations

    returns:
        list of k cluster centroids
    """
    n = len(vectors)

    # initialize centroids by random selection
    rng = random.Random(42)
    indices = rng.sample(range(n), k)
    centroids = [list(vectors[i]) for i in indices]

    for _ in range(max_iter):
        # assign each vector to nearest centroid
        assignments = []
        for vec in vectors:
            best_c = 0
            best_dist = _squared_distance(vec, centroids[0])
            for c in range(1, k):
                d = _squared_distance(vec, centroids[c])
                if d < best_dist:
                    best_dist = d
                    best_c = c
            assignments.append(best_c)

        # update centroids
        new_centroids: list[Vector] = []
        for c in range(k):
            members = [vectors[i] for i in range(n) if assignments[i] == c]
            if members:
                count = len(members)
                summed = members[0][:]
                for m in members[1:]:
                    summed = _vec_add(summed, m)
                new_centroids.append(_vec_scale(summed, 1.0 / count))
            else:
                new_centroids.append(list(centroids[c]))

        # check convergence
        converged = all(
            _squared_distance(centroids[c], new_centroids[c]) < 1e-12 for c in range(k)
        )
        centroids = new_centroids
        if converged:
            break

    return centroids


async def get_playlist_recommendations(
    track_ids: list[int],
    limit: int = 3,
) -> list[VectorSearchResult]:
    """get track recommendations for a playlist.

    uses adaptive strategy based on playlist size:
    - 1 track: query turbopuffer with that track's embedding directly
    - 2-5 tracks: query with each track's embedding, merge via RRF
    - 6+ tracks: k-means cluster, query centroids, RRF merge

    args:
        track_ids: IDs of tracks currently in the playlist
        limit: max number of recommendations to return

    returns:
        list of recommended tracks (excluding playlist tracks)
    """
    if not track_ids:
        return []

    # fetch embeddings for playlist tracks
    vectors = await get_vectors(track_ids)
    if not vectors:
        return []

    exclude_ids = set(track_ids)
    # request more than needed to account for exclusions
    top_k = limit + len(track_ids) + 5

    n_vectors = len(vectors)

    if n_vectors == 1:
        # single track: query directly with its embedding
        embedding = next(iter(vectors.values()))
        results = await query(embedding, top_k=top_k)
        return [r for r in results if r.track_id not in exclude_ids][:limit]

    vec_list = list(vectors.values())

    if n_vectors <= 5:
        # query each track embedding in parallel, merge with RRF
        tasks = [query(vec, top_k=top_k) for vec in vec_list]
        ranked_lists = await asyncio.gather(*tasks)
        merged = rrf_merge(list(ranked_lists), exclude_ids)
        return merged[:limit]

    # 6+ tracks: k-means cluster, query centroids
    n_clusters = min(3, n_vectors // 2)
    centroids = _kmeans(vec_list, n_clusters)

    tasks = [query(centroid, top_k=top_k) for centroid in centroids]
    ranked_lists = await asyncio.gather(*tasks)
    merged = rrf_merge(list(ranked_lists), exclude_ids)
    return merged[:limit]
