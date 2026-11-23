#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12,<3.14"
# # numpy<2.2 + python<3.14: umap-learn's transitive numba/llvmlite have no wheel
# # outside that window, so an unpinned solve backtracks into source builds.
# dependencies = [
#     "httpx",
#     "numpy<2.2",
#     "psycopg[binary]",
#     "scikit-learn",
#     "umap-learn",
#     "hdbscan",
#     "pydantic-settings",
#     "anthropic",
# ]
# ///
"""build next's atlas: a 2D semantic map of the public catalog.

everything comes from next, never from the legacy python api or its database:

- the corpus is next's public catalog (`fm.plyr.unspecced.listTracks`), the
  same anonymous discovery surface as home, minus adult/copyright labels and
  anything gated or private.
- vectors are CLAP audio embeddings kept in next's postgres
  (`plyr_index.track_embeddings`, migration 0060). tracks without one, or
  whose audio changed, are embedded through the Modal CLAP endpoint, a few
  hundred per run. `--seed-turbopuffer` copies the legacy vectors in once,
  matched by each track's `legacy_id`, so the first build doesn't re-embed
  the whole legacy catalog.
- the map is projected (PCA + UMAP), clustered in a separate 10D space
  (HDBSCAN, two tiers), labelled by c-TF-IDF with optional claude
  refinement (pub-search's build-atlas, see its docs/atlas.md), and written
  to `plyr_index.atlas_snapshots`, which the api serves as
  `fm.plyr.unspecced.getAtlas`.

usage (next-build-atlas.yml runs it daily):
    export DATABASE_URL=postgresql://...      # next's writer login
    export ANTHROPIC_API_KEY=...              # optional: refined labels
    export TURBOPUFFER_API_KEY=...            # only with --seed-turbopuffer
    uv run next/scripts/build-atlas.py [--seed-turbopuffer] [-o atlas.json] [--dry-run]
"""

import argparse
import asyncio
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import NamedTuple

import httpx
import numpy as np
import psycopg
from pydantic import ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict
from sklearn.decomposition import PCA
from sklearn.feature_extraction.text import TfidfVectorizer

EXCLUDED_LABELS = {"sexual", "porn", "copyright-violation"}
EMBED_MODEL = "laion/clap-htsat-unfused"
EMBED_DIMS = 512


def log(msg: str) -> None:
    print(msg, flush=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str
    api_origin: str = "https://api.next.plyr.fm"
    track_namespace: str = "fm.plyr"
    clap_embed_url: str = (
        "https://zzstoatzz--plyr-clap-clapservice-embed-audio.modal.run"
    )
    embed_limit: int = 300
    turbopuffer_api_key: str = ""
    turbopuffer_region: str = "api"
    turbopuffer_namespace: str = "plyr-tracks"
    anthropic_api_key: str = ""


def tpuf_export(settings: Settings) -> list[dict]:
    """export all vectors from turbopuffer via paginated query."""
    url = (
        f"https://{settings.turbopuffer_region}.turbopuffer.com"
        f"/v2/namespaces/{settings.turbopuffer_namespace}/query"
    )
    headers = {
        "Authorization": f"Bearer {settings.turbopuffer_api_key}",
        "Content-Type": "application/json",
    }
    rows: list[dict] = []
    last_id = None
    with httpx.Client(timeout=120) as client:
        while True:
            body: dict = {
                "rank_by": ["id", "asc"],
                "limit": 10000,
                "include_attributes": ["vector"],
            }
            if last_id is not None:
                body["filters"] = ["id", "Gt", last_id]
            resp = client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            page = resp.json().get("rows", [])
            if not page:
                break
            rows.extend(page)
            last_id = page[-1]["id"]
            log(f"  fetched {len(rows)} vectors so far...")
            if len(page) < 10000:
                break
    return rows


def plain_url(db_url: str) -> str:
    # the CI secret may carry a sqlalchemy driver suffix psycopg can't parse
    return re.sub(r"postgresql\+\w+://", "postgresql://", db_url)


def xrpc(client: httpx.Client, settings: Settings, method: str, **params) -> dict:
    url = f"{settings.api_origin}/xrpc/{settings.track_namespace}.unspecced.{method}"
    resp = client.get(url, params={k: v for k, v in params.items() if v is not None})
    resp.raise_for_status()
    return resp.json()


def eligible(track: dict) -> bool:
    access = track.get("access") or {}
    moderation = track.get("moderation") or {}
    labels = (
        set(moderation.get("self_labels") or [])
        | set(moderation.get("operator_labels") or [])
        | set(moderation.get("account_labels") or [])
    )
    return (
        access.get("visibility") == "public"
        and not access.get("gate")
        and not access.get("space_uri")
        and not labels & EXCLUDED_LABELS
    )


def load_corpus(client: httpx.Client, settings: Settings) -> dict[str, dict]:
    """next's public catalog, keyed by track id, in the shape the map needs."""
    corpus: dict[str, dict] = {}
    cursor = None
    while True:
        page = xrpc(client, settings, "listTracks", limit=100, cursor=cursor)
        for track in page.get("data", []):
            if not eligible(track):
                continue
            profile = (track.get("artist") or {}).get("profile") or {}
            artwork = ((track.get("media") or {}).get("artwork") or {}).get("url")
            corpus[track["id"]] = {
                "id": track["id"],
                "uri": track["record"]["uri"],
                "cid": track["record"].get("cid") or "",
                "legacy_id": track.get("legacy_id"),
                "title": track["metadata"]["title"],
                "tags": track["metadata"].get("tags") or [],
                "thumbnail_url": artwork,
                "image_url": artwork,
                "play_count": (track.get("metrics") or {}).get("play_count", 0),
                "like_count": (track.get("metrics") or {}).get("like_count", 0),
                "artist_did": track["artist"]["did"],
                "artist_handle": profile.get("handle") or track["artist"]["did"],
                "artist_name": profile.get("display_name"),
                "artist_avatar": profile.get("avatar_url"),
            }
        cursor = page.get("next_cursor")
        if not page.get("has_more") or not cursor:
            return corpus


def audio_ref(
    client: httpx.Client, settings: Settings, track: dict
) -> tuple[str, str] | None:
    """(ref, url) for a track's public audio: the blob cid when it has one."""
    playback = xrpc(client, settings, "getPlayback", uri=track["uri"])
    availability = playback.get("availability") or {}
    delivery = availability.get("delivery") or {}
    url = delivery.get("url")
    if (
        availability.get("status") != "available"
        or not url
        or not url.startswith("https://")
    ):
        return None
    artifact = availability.get("artifact") or {}
    return artifact.get("cid") or url, url


class Embedded(NamedTuple):
    record_cid: str
    audio_ref: str
    vector: list[float]


def load_vectors(conn: psycopg.Connection) -> dict[str, Embedded]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT record_uri, record_cid, audio_ref, embedding::text FROM plyr_index.track_embeddings"
        )
        return {
            uri: Embedded(cid, ref, json.loads(vec))
            for uri, cid, ref, vec in cur.fetchall()
        }


def store_vector(
    conn: psycopg.Connection, track: dict, ref: str, vector: list[float] | None
) -> None:
    """record a track's vector; without one, only note that this version's audio is unchanged."""
    if vector is None:
        conn.execute(
            "UPDATE plyr_index.track_embeddings SET record_cid = %s WHERE record_uri = %s",
            (track["cid"], track["uri"]),
        )
        conn.commit()
        return
    if not isinstance(vector, list) or len(vector) != EMBED_DIMS:
        raise ValueError(f"expected {EMBED_DIMS} dims")
    conn.execute(
        """
        INSERT INTO plyr_index.track_embeddings (record_uri, record_cid, audio_ref, model, embedding)
        VALUES (%s, %s, %s, %s, %s::vector)
        ON CONFLICT (record_uri) DO UPDATE SET record_cid = EXCLUDED.record_cid,
          audio_ref = EXCLUDED.audio_ref, model = EXCLUDED.model,
          embedding = EXCLUDED.embedding, embedded_at = clock_timestamp()
        """,
        (track["uri"], track["cid"], ref, EMBED_MODEL, json.dumps(vector)),
    )
    conn.commit()


def seed_from_turbopuffer(
    client: httpx.Client,
    conn: psycopg.Connection,
    settings: Settings,
    corpus: dict[str, dict],
) -> None:
    """copy legacy vectors in, once, for tracks that came over from prod."""
    by_legacy = {str(t["legacy_id"]): t for t in corpus.values() if t["legacy_id"]}
    have = load_vectors(conn)
    copied = 0
    for row in tpuf_export(settings):
        track = by_legacy.get(str(row["id"]))
        if not track or track["uri"] in have or not row.get("vector"):
            continue
        ref = audio_ref(client, settings, track)
        if ref is None:
            continue
        store_vector(conn, track, ref[0], row["vector"])
        copied += 1
    log(f"  copied {copied} legacy vectors")


def embed_missing(
    client: httpx.Client,
    conn: psycopg.Connection,
    settings: Settings,
    corpus: dict[str, dict],
) -> None:
    """embed tracks with no vector, or whose audio changed, up to the run's limit."""
    have = load_vectors(conn)
    embedded = failed = checked = 0
    for track in corpus.values():
        known = have.get(track["uri"])
        if known and known.record_cid == track["cid"]:
            continue
        if embedded >= settings.embed_limit:
            log(
                f"  reached the limit of {settings.embed_limit}; the rest wait for the next run"
            )
            break
        ref = audio_ref(client, settings, track)
        checked += 1
        if ref is None:
            continue
        if known and known.audio_ref == ref[0]:
            store_vector(conn, track, ref[0], None)
            continue
        try:
            resp = client.post(
                settings.clap_embed_url, json={"audio_url": ref[1]}, timeout=300
            )
            resp.raise_for_status()
            # the endpoint answers 200 with {"error": ...} when the audio can't be read
            vector = resp.json().get("embedding")
            if vector is None:
                raise ValueError("no embedding")
            store_vector(conn, track, ref[0], vector)
            embedded += 1
        except (httpx.HTTPError, ValueError) as e:
            failed += 1
            log(f"  embedding failed for {track['uri']}: {type(e).__name__}")
    log(f"  checked {checked}, embedded {embedded}, failed {failed}")


def extract_terms(text: str) -> str:
    return " ".join(t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 1)


def cluster_tfidf_labels(
    docs_per_cluster: dict[int, list[str]], n_terms: int = 3
) -> dict[int, str]:
    """c-TF-IDF keyword labels: one pseudo-document per cluster."""
    cluster_ids = sorted(docs_per_cluster.keys())
    if not cluster_ids:
        return {}
    docs = [" ".join(docs_per_cluster[cid]) for cid in cluster_ids]
    vectorizer = TfidfVectorizer(
        max_features=5000,
        stop_words="english",
        token_pattern=r"[a-z0-9]{2,}",
        lowercase=True,
    )
    try:
        tfidf = vectorizer.fit_transform(docs)
    except ValueError:
        return {cid: f"cluster {cid}" for cid in cluster_ids}
    feature_names = vectorizer.get_feature_names_out()
    labels = {}
    for i, cid in enumerate(cluster_ids):
        row = tfidf[i].toarray().flatten()
        top_idx = row.argsort()[-n_terms:][::-1]
        top_terms = [feature_names[j] for j in top_idx if row[j] > 0]
        labels[cid] = " ".join(top_terms) if top_terms else f"cluster {cid}"
    return labels


def llm_refine_labels(
    tfidf_labels: dict[int, str],
    evidence_per_cluster: dict[int, list[str]],
    cluster_counts: dict[int, int],
    api_key: str,
    tier: str,
    batch_size: int = 15,
) -> dict[int, str]:
    """refine keyword labels into short region names with claude haiku."""
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=api_key)
    rng = np.random.default_rng(42)
    cluster_ids = sorted(tfidf_labels.keys())
    batches = [
        cluster_ids[i : i + batch_size] for i in range(0, len(cluster_ids), batch_size)
    ]

    system_instructions = (
        "You are labeling clusters for a music atlas — a 2D map of a track catalog "
        "where each cluster groups tracks that sound alike (clustered on audio "
        "embeddings, not text).\n\n"
        "For each cluster you receive its keyword seed plus sample track titles and "
        "listener tags. Write a short evocative label (2-4 lowercase words) that names "
        "the sonic territory, like a region on a map.\n\n"
        'Good labels: "ambient drift", "bedroom pop", "heavy guitars", '
        '"late night electronic", "acoustic folk", "glitch experiments"\n'
        'Bad labels: "track song mix", "untitled demo 2", "cluster seven"\n\n'
        "Respond with ONLY a JSON object mapping cluster ID (as string) to label. "
        "No other text."
    )

    async def label_batch(batch: list[int]) -> dict[int, str]:
        parts = []
        for cid in batch:
            evidence = evidence_per_cluster.get(cid, [])
            sample = (
                list(rng.choice(evidence, size=min(12, len(evidence)), replace=False))
                if evidence
                else []
            )
            parts.append(
                f"Cluster {cid} ({cluster_counts.get(cid, 0)} tracks):\n"
                f"  Keywords: {tfidf_labels[cid]}\n"
                f"  Samples: {', '.join(repr(t) for t in sample)}"
            )
        resp = await client.messages.create(
            model="claude-haiku-5-5",
            max_tokens=4096,
            output_config={"effort": "low"},
            system=[
                {
                    "type": "text",
                    "text": system_instructions,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": "\n\n".join(parts)}],
        )
        text = "".join(
            block.text for block in resp.content if block.type == "text"
        ).strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        try:
            parsed = json.loads(text)
            return {int(k): str(v) for k, v in parsed.items()}
        except (json.JSONDecodeError, ValueError):
            log("  warning: failed to parse LLM response for a batch, keeping keywords")
            return {}

    async def run_all() -> dict[int, str]:
        results = await asyncio.gather(*[label_batch(b) for b in batches])
        merged: dict[int, str] = {}
        for r in results:
            merged.update(r)
        return merged

    log(
        f"  refining {tier} labels with LLM ({len(batches)} batches, {len(cluster_ids)} clusters)..."
    )
    refined = asyncio.run(run_all())
    log(f"  {tier}: {len(refined)}/{len(cluster_ids)} labels refined")
    return {cid: refined.get(cid, tfidf_labels[cid]) for cid in cluster_ids}


def assign_outliers(
    coords: np.ndarray, labels: np.ndarray, centroids: dict[int, np.ndarray]
) -> np.ndarray:
    """snap outlier points (label == -1) to the nearest cluster centroid."""
    result = labels.copy()
    outlier_mask = result == -1
    if not outlier_mask.any() or not centroids:
        return result
    centroid_ids = sorted(centroids.keys())
    centroid_arr = np.array([centroids[c] for c in centroid_ids])
    dists = np.linalg.norm(
        coords[outlier_mask][:, None] - centroid_arr[None, :], axis=2
    )
    result[outlier_mask] = np.array(centroid_ids)[dists.argmin(axis=1)]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="build next's atlas")
    parser.add_argument("--output", "-o", help="also write the map to this file")
    parser.add_argument(
        "--seed-turbopuffer", action="store_true", help="copy legacy vectors in first"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="build the map but don't store it"
    )
    args = parser.parse_args()

    try:
        settings = Settings()  # type: ignore[call-arg]
    except ValidationError as e:
        # never print the exception itself: pydantic embeds input values,
        # which here would mean leaking unrelated env secrets into logs.
        fields = ", ".join(str(err["loc"][0]) for err in e.errors()) or "config"
        print(f"error loading settings; missing/invalid: {fields}", file=sys.stderr)
        sys.exit(1)
    if args.seed_turbopuffer and not settings.turbopuffer_api_key:
        print("--seed-turbopuffer needs TURBOPUFFER_API_KEY", file=sys.stderr)
        sys.exit(1)

    t_start = time.monotonic()
    client = httpx.Client(timeout=60, headers={"user-agent": "plyr.fm atlas builder"})
    conn = psycopg.connect(plain_url(settings.database_url))

    log("loading next's public catalog...")
    corpus = load_corpus(client, settings)
    log(f"  {len(corpus)} atlas-eligible tracks")

    if args.seed_turbopuffer:
        log("copying legacy vectors from turbopuffer...")
        seed_from_turbopuffer(client, conn, settings, corpus)

    log("embedding new and changed audio...")
    embed_missing(client, conn, settings, corpus)

    vectors = load_vectors(conn)
    keyed = [
        (tid, vectors[t["uri"]].vector)
        for tid, t in corpus.items()
        if t["uri"] in vectors
    ]
    skipped = len(corpus) - len(keyed)
    if skipped:
        log(f"  {skipped} eligible tracks have no embedding yet (not on the map)")
    if len(keyed) < 30:
        print("too few embedded tracks to build an atlas", file=sys.stderr)
        sys.exit(1)

    # float64: randomized SVD overflows in float32 on these magnitudes
    X = np.empty((len(keyed), len(keyed[0][1])), dtype=np.float64)
    meta: list[dict] = []
    for i, (track_id, vec) in enumerate(keyed):
        X[i] = vec
        meta.append(corpus[track_id])
    log(f"  {X.shape[0]} vectors, {X.shape[1]} dims")

    log("PCA → 50...")
    n_components = min(50, X.shape[0] - 1, X.shape[1])
    pca = PCA(n_components=n_components, random_state=42)
    X_pca = pca.fit_transform(X)
    log(f"  variance explained: {pca.explained_variance_ratio_.sum():.2%}")

    log("UMAP 50 → 2 (display)...")
    import umap

    X_2d = umap.UMAP(
        n_components=2, metric="cosine", n_neighbors=15, min_dist=0.1, random_state=42
    ).fit_transform(X_pca)
    for dim in range(2):
        lo, hi = X_2d[:, dim].min(), X_2d[:, dim].max()
        if hi > lo:
            X_2d[:, dim] = 2 * (X_2d[:, dim] - lo) / (hi - lo) - 1

    # cluster in a dedicated 10D UMAP, not the 2D display coords — clustering
    # the display projection turns its own artifacts into cluster boundaries
    # (measured in pub-search: the fine tier scored worse than chance in 2D).
    log("UMAP 50 → 10 (clustering space)...")
    X_10d = umap.UMAP(
        n_components=10, metric="cosine", n_neighbors=30, min_dist=0.0, random_state=42
    ).fit_transform(X_pca)

    import hdbscan

    def cluster_tier(name: str, min_cluster_size: int, min_samples: int):
        log(f"HDBSCAN {name} (min_cluster_size={min_cluster_size}) on 10D...")
        raw = hdbscan.HDBSCAN(
            min_cluster_size=min_cluster_size, min_samples=min_samples
        ).fit_predict(X_10d)
        n_clusters = len(set(raw)) - (1 if -1 in raw else 0)
        n_out = int((raw == -1).sum())
        log(f"  {n_clusters} clusters, {n_out} outliers ({n_out / len(raw):.1%})")
        centroids_10d = {
            cid: X_10d[raw == cid].mean(axis=0) for cid in set(raw) if cid != -1
        }
        labels = assign_outliers(X_10d, raw, centroids_10d)
        centroids_2d = {cid: X_2d[labels == cid].mean(axis=0) for cid in set(labels)}
        return labels, centroids_2d, raw != -1

    # thresholds sized for a catalog of ~1k tracks (pub-search's 50/20 would
    # collapse this corpus into a couple of blobs)
    n = X.shape[0]
    coarse_size = max(12, n // 60)
    fine_size = max(5, n // 160)
    labels_coarse, coarse_centroids, core_coarse = cluster_tier(
        "coarse", coarse_size, 5
    )
    labels_fine, fine_centroids, core_fine = cluster_tier("fine", fine_size, 2)

    # label evidence: titles + tags of CORE members only — points HDBSCAN
    # actually assigned. snapped outliers blur the vocabulary a label draws on.
    # a cluster whose core evidence is empty falls back to full membership.
    log("computing cluster labels (c-TF-IDF on titles+tags)...")

    def evidence_for(i: int) -> str:
        m = meta[i]
        parts = [m["title"] or ""]
        parts.extend(m["tags"] or [])
        return extract_terms(" ".join(parts))

    def display_evidence(i: int) -> str:
        m = meta[i]
        tags = ", ".join(m["tags"] or [])
        return f"{m['title']}" + (f" [{tags}]" if tags else "")

    def collect(
        labels: np.ndarray, core: np.ndarray, centroids: dict
    ) -> tuple[dict, dict]:
        docs: dict[int, list[str]] = {int(c): [] for c in centroids}
        samples: dict[int, list[str]] = {int(c): [] for c in centroids}
        docs_all: dict[int, list[str]] = {int(c): [] for c in centroids}
        samples_all: dict[int, list[str]] = {int(c): [] for c in centroids}
        for i in range(n):
            ev = evidence_for(i)
            if not ev:
                continue
            cid = int(labels[i])
            docs_all[cid].append(ev)
            samples_all[cid].append(display_evidence(i))
            if core[i]:
                docs[cid].append(ev)
                samples[cid].append(display_evidence(i))
        for cid, evidence in docs.items():
            if not evidence:
                docs[cid] = docs_all[cid]
                samples[cid] = samples_all[cid]
        return docs, samples

    coarse_docs, coarse_samples = collect(labels_coarse, core_coarse, coarse_centroids)
    fine_docs, fine_samples = collect(labels_fine, core_fine, fine_centroids)
    coarse_labels = cluster_tfidf_labels(coarse_docs)
    fine_labels = cluster_tfidf_labels(fine_docs)

    if settings.anthropic_api_key:
        coarse_counts = {
            int(c): int((labels_coarse == c).sum()) for c in set(labels_coarse)
        }
        fine_counts = {int(c): int((labels_fine == c).sum()) for c in set(labels_fine)}
        try:
            coarse_labels = llm_refine_labels(
                coarse_labels,
                coarse_samples,
                coarse_counts,
                settings.anthropic_api_key,
                "coarse",
            )
            fine_labels = llm_refine_labels(
                fine_labels,
                fine_samples,
                fine_counts,
                settings.anthropic_api_key,
                "fine",
            )
        except Exception as e:  # noqa: BLE001 - labels are optional; keywords stand in
            log(f"  LLM labeling failed, keeping c-TF-IDF labels: {e}")
    else:
        log("  (no ANTHROPIC_API_KEY — c-TF-IDF labels only)")

    fine_to_coarse = {}
    for fine_id in set(labels_fine):
        counts = Counter(labels_coarse[labels_fine == fine_id])
        fine_to_coarse[int(fine_id)] = int(counts.most_common(1)[0][0])

    # artist centroids (2+ mapped tracks) — the "publications" of this atlas
    log("computing artist centroids...")
    by_artist: dict[str, list[int]] = {}
    for i, m in enumerate(meta):
        by_artist.setdefault(m["artist_did"], []).append(i)
    artists = []
    for did, indices in by_artist.items():
        if len(indices) < 2:
            continue
        centroid = X_2d[indices].mean(axis=0)
        m = meta[indices[0]]
        artists.append(
            {
                "did": did,
                "handle": m["artist_handle"],
                "name": m["artist_name"] or m["artist_handle"],
                "avatar": m["artist_avatar"] or "",
                "cx": round(float(centroid[0]), 4),
                "cy": round(float(centroid[1]), 4),
                "count": len(indices),
            }
        )
    artists.sort(key=lambda a: a["count"], reverse=True)
    log(f"  {len(artists)} artists with 2+ tracks on the map")

    log("building output...")
    points = []
    for i, m in enumerate(meta):
        points.append(
            {
                "x": round(float(X_2d[i, 0]), 4),
                "y": round(float(X_2d[i, 1]), 4),
                "id": m["id"],
                "title": m["title"],
                "artist": m["artist_name"] or m["artist_handle"],
                "handle": m["artist_handle"],
                "thumb": m["thumbnail_url"] or m["image_url"] or "",
                "plays": m["play_count"],
                "likes": m["like_count"],
                "clusterCoarse": int(labels_coarse[i]),
                "clusterFine": int(labels_fine[i]),
                "core": bool(core_fine[i]),
            }
        )

    def cluster_payload(
        centroids: dict, counts_src: np.ndarray, labels: dict, extra=None
    ):
        out = []
        for cid in sorted(centroids.keys()):
            entry = {
                "id": int(cid),
                "label": labels.get(int(cid), f"cluster {cid}"),
                "cx": round(float(centroids[cid][0]), 4),
                "cy": round(float(centroids[cid][1]), 4),
                "count": int((counts_src == cid).sum()),
            }
            if extra:
                entry.update(extra(int(cid)))
            out.append(entry)
        return out

    output = {
        "points": points,
        "clusters": {
            "coarse": cluster_payload(coarse_centroids, labels_coarse, coarse_labels),
            "fine": cluster_payload(
                fine_centroids,
                labels_fine,
                fine_labels,
                extra=lambda cid: {"parent": fine_to_coarse.get(cid, 0)},
            ),
        },
        "artists": artists,
        "meta": {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "nTracks": len(points),
        },
    }

    body = json.dumps(output, separators=(",", ":"))
    log(f"\nbuilt the map ({len(body) / 1024:.0f} KB, {len(points)} points)")
    if args.output:
        Path(args.output).write_text(body)
        log(f"wrote {args.output}")
    if args.dry_run:
        log("dry run: not stored")
    else:
        conn.execute(
            """
            INSERT INTO plyr_index.atlas_snapshots (id, body) VALUES (1, %s::jsonb)
            ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, built_at = clock_timestamp()
            """,
            (body,),
        )
        conn.commit()
        log("stored as next's atlas snapshot")
    conn.close()
    client.close()

    log(f"done in {time.monotonic() - t_start:.1f}s")


if __name__ == "__main__":
    main()
