"""Persistent, bounded Python composition and peer curation on home-pool."""

import fcntl
import json
import os
from datetime import UTC, datetime
from pathlib import Path

from prefect import flow, get_run_logger, task
from prefect.artifacts import create_markdown_artifact
from prefect.cache_policies import NO_CACHE
from prefect.states import Completed, State

from audio_round import prepare_release
from compose import Composition, compose, render
from studio.context import choose_peer
from studio.identity import Musician
from studio.listening import NotReady
from studio.platform import Platform, credentials
from studio.state import Store

ROOT = Path(__file__).parent


@task(name="load-musicians", cache_policy=NO_CACHE, persist_result=False)
def seed(directory: Path) -> list[str]:
    store = Store(directory)
    existing = store.musicians()
    accounts = json.loads((ROOT / "accounts.json").read_text())
    for name, account in accounts.items():
        with Platform(credentials(name)) as client:
            artist = client.request("GET", "/artists/me")
        if artist["did"] != account["did"]:
            raise ValueError("Musician credential belongs to another account")
        path = ROOT / "profiles" / f"{name}.json"
        if path.stem not in existing:
            entry = json.loads(path.read_text())
            Musician.model_validate(entry["profile"])
            store.save_musician(path.stem, entry)
    names = list(store.musicians())
    if not 2 <= len(names) <= 10:
        raise ValueError("Expected 2–10 provisioned musicians")
    return names


@task(
    name="compose-python",
    task_run_name="{name}-compose",
    cache_policy=NO_CACHE,
    persist_result=False,
)
def compose_piece(directory: Path, session: str, name: str) -> dict:
    store = Store(directory)
    saved = store.study(session, name) or {}
    if saved.get("python"):
        Composition.model_validate(saved)
        return saved
    profile = Musician.model_validate(store.musicians()[name]["profile"])
    peer = saved.get("peer") or choose_peer(store, name, session)
    store.save_study(session, name, {"peer": peer})
    piece = compose(
        profile,
        store.history(name, session),
        store,
        session,
        musician_id=name,
        peer=peer,
    )
    store.save_study(session, name, piece.model_dump())
    entry = store.musicians()[name]
    if piece.taste is not None:
        entry["profile"]["taste"] = piece.taste.model_dump()
    if piece.inspirations is not None:
        entry["profile"]["inspirations"] = [
            value.model_dump() for value in piece.inspirations
        ]
    store.save_musician(name, entry)
    return store.study(session, name)


@task(
    name="render-python",
    task_run_name="{name}-render",
    cache_policy=NO_CACHE,
    persist_result=False,
)
def render_piece(directory: Path, session: str, name: str) -> Path:
    store = Store(directory)
    study = store.study(session, name)
    output = directory / f"{session}-{name}" / "audio"
    if study.get("rendered") and (output / "track.wav").is_file():
        return output / "track.wav"
    metrics = render(study["python"], output)
    store.save_study(session, name, {"rendered": True, "metrics": metrics})
    return output / "track.wav"


@task(
    name="listen-revise-and-peer-review",
    task_run_name="{name}-audio-review",
    cache_policy=NO_CACHE,
    persist_result=False,
)
def review_audio(directory: Path, session: str, name: str, path: Path) -> Path:
    return prepare_release(directory, session, name, path)


@task(
    name="publish-unlisted",
    task_run_name="{name}-publish",
    cache_policy=NO_CACHE,
    persist_result=False,
)
def publish_piece(directory: Path, session: str, name: str, path: Path) -> int | None:
    with Platform(credentials(name)) as client:
        return client.publish(Store(directory), session, name, path)


@task(
    name="curate-peer",
    task_run_name="{name}-playlist",
    cache_policy=NO_CACHE,
    persist_result=False,
)
def curate_peer(directory: Path, session: str, name: str) -> None:
    store = Store(directory)
    study = store.study(session, name)
    if not study.get("keep_peer") or not study.get("peer"):
        return
    if study.get("curated"):
        return
    entry = store.musicians()[name]
    with Platform(credentials(name)) as client:
        playlist_id = entry.get("playlist_id")
        if not playlist_id:
            playlist_id = client.playlist(entry["profile"]["name"])
            entry["playlist_id"] = playlist_id
            store.save_musician(name, entry)
        client.curate(playlist_id, study["peer"]["work"]["track_id"])
    store.save_study(session, name, {"curated": True, "playlist_id": playlist_id})


def report(store: Store, session: str | None, errors: list[str]) -> None:
    usage = store.usage(datetime.now(UTC))
    get_run_logger().info("Studio cost ledger: %s", json.dumps(usage))
    month = usage["month"]
    create_markdown_artifact(
        key="plyr-fm-musician-costs",
        markdown=(
            f"# Musician cost ledger\n\n{month['sessions']} sessions; {month['calls']} requests this UTC month.\n\n"
            f"Estimated model usage: ${month['estimated_cost']:.6f}. Reserved/charged: ${month['budget_used']:.2f} / $5 monthly.\n\n"
            f"Today: ${usage['day']['budget_used']:.2f} / $0.20 reserved/charged.\n\n"
            "Failed reservations remain charged. Model usage is an estimate, not an invoice; hosting, storage, and subscriptions are excluded. "
            "Exhausted budgets pause model work until the next available UTC budget window."
        ),
    )
    notes = []
    if session:
        for name in store.musicians():
            study = store.study(session, name) or {}
            if not study:
                continue
            peer = study.get("peer")
            notes.append(
                f"## {name}: {study.get('title', 'unfinished')}\n\n{study.get('idea', '')}\n\n"
                f"Memory: {study.get('memory', '')}\n\n"
                + "\n\n".join(
                    f"Audio review by {r['listener']} ({r['model']}, {r['audio_tokens']} audio tokens): {r['observations']} Next: {r['changes']}"
                    for r in study.get("audio_feedback", [])
                )
                + "\n\n"
                + (
                    f"Studied {peer['name']}: {study.get('peer_note', '')}\n\n"
                    if peer
                    else "No published peer work available yet.\n\n"
                )
                + (
                    f"[Track](https://plyr.fm/track/{study['track_id']})\n\n"
                    if study.get("track_id")
                    else "No new upload.\n\n"
                )
                + (
                    f"[Playlist](https://plyr.fm/playlist/{study['playlist_id']})"
                    if study.get("playlist_id")
                    else ""
                )
            )
    create_markdown_artifact(
        key="plyr-fm-musician-progress",
        markdown=(
            f"# Community session {session or 'skipped'}\n\n"
            + "\n\n".join(notes)
            + ("\n\nFailures: " + "; ".join(errors) if errors else "")
        ),
    )


@flow(
    name="plyr.fm-musician-community",
    flow_run_name=lambda: (
        "plyr.fm-studio-" + datetime.now(UTC).strftime("%Y-%m-%d-%H%MZ")
    ),
    timeout_seconds=900,
    log_prints=True,
    persist_result=False,
)
def community(retry_failed: bool = False, bootstrap: bool = False) -> State:
    directory = Path(os.environ["STUDIO_STATE_DIR"])
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "session.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return Completed(
                name="Skipped", message="Another studio run owns the worker lock"
            )
        store = Store(directory)
        session = store.reserve(
            datetime.now(UTC), retry_failed=retry_failed, bootstrap=bootstrap
        )
        errors = []
        logger = get_run_logger()
        if session is None:
            report(store, None, errors)
            return Completed(
                name="Skipped", message="Session slot or estimated budget unavailable"
            )
        try:
            names = seed(directory)
            now = datetime.now(UTC)
            selected = names[(now.toordinal() * 4 + now.hour // 6) % len(names)]
            for name in [selected]:
                try:
                    compose_piece(directory, session, name)
                    audio = render_piece(directory, session, name)
                    audio = review_audio(directory, session, name, audio)
                    publish_piece(directory, session, name, audio)
                    curate_peer(directory, session, name)
                except NotReady as exc:
                    store.save_study(session, name, {"withheld": True})
                    logger.info("%s: %s", name, exc)
                except Exception as exc:
                    errors.append(f"{name}: {type(exc).__name__}: {exc}")
                    logger.exception("Musician %s failed", name)
            if errors:
                raise RuntimeError("; ".join(errors))
            store.finish(session, "completed")
        except BaseException:
            store.finish(session, "failed")
            raise
        finally:
            report(store, session, errors)
    return Completed(message="Music study finished; publication follows audio review")
