"""Scheduled musician sessions on the persistent home-pool worker."""

import fcntl
import json
import os
import random
from datetime import UTC, datetime
from pathlib import Path

from prefect import flow, task
from prefect.artifacts import create_markdown_artifact
from prefect.cache_policies import NO_CACHE
from prefect.states import Completed

from studio.audio import render
from studio.brain import decide
from studio.models import Decision, select_peer
from studio.publishing import curate, publish
from studio.state import Store

ROOT = Path(__file__).resolve().parents[1]


@task(name="load-persistent-community", cache_policy=NO_CACHE, persist_result=False)
def seed(directory: Path) -> dict:
    store = Store(directory)
    roster = store.musicians()
    published = json.loads((ROOT / "published.json").read_text())
    for path in sorted((ROOT / "profiles").glob("*.json")):
        key = path.stem
        if key in roster:
            continue
        initial = json.loads(path.read_text())
        initial.update(published[key])
        initial["score"] = json.loads(
            (ROOT / "taste-results" / f"{key}_peer.json").read_text()
        )["answer"]["score"]
        initial["published_score"] = initial["score"]
        store.save_study(
            initial["published_at"][:10] + "-seed",
            key,
            {"upload_attempted": True, "track_id": initial["track_id"]},
        )
        initial["memory"] = ""
        store.save_musician(key, initial)
    roster = store.musicians()
    if not 2 <= len(roster) <= 10:
        raise ValueError("Community requires 2–10 provisioned musicians")
    return roster


@task(
    name="study-peer-and-compose",
    task_run_name="{name}-study",
    cache_policy=NO_CACHE,
    persist_result=False,
    retries=0,
)
def study_peer(directory: Path, session: str, name: str, roster: dict) -> dict:
    store = Store(directory)
    peer, probabilities = select_peer(name, roster, random.Random(f"{session}:{name}"))
    decision = decide(
        store,
        session,
        roster[name],
        {**roster[peer], "score": roster[peer]["published_score"]},
    )
    study = {
        "peer": peer,
        "peer_name": roster[peer]["profile"]["name"],
        "probabilities": probabilities,
        "decision": decision.model_dump(),
    }
    store.save_study(session, name, study)
    entry = roster[name].copy()
    entry["profile"] = {**entry["profile"], "taste": decision.taste.model_dump()}
    entry.update(memory=decision.memory, score=decision.score.model_dump())
    store.save_musician(name, entry)
    return study


@task(
    name="render-ten-second-study",
    task_run_name="{name}-render",
    cache_policy=NO_CACHE,
    persist_result=False,
    retries=0,
)
def render_study(directory: Path, session: str, name: str, study: dict) -> Path:
    return render(
        Decision.model_validate(study["decision"]).score, directory, f"{session}-{name}"
    )


@task(
    name="publish-unlisted-study",
    task_run_name="{name}-publish",
    cache_policy=NO_CACHE,
    persist_result=False,
    retries=0,
)
def publish_study(
    directory: Path, session: str, name: str, path: Path, study: dict
) -> int | None:
    store = Store(directory)
    track_id = publish(
        store, session, name, path, Decision.model_validate(study["decision"]), study
    )
    if track_id:
        entry = store.musicians()[name]
        entry["track_id"] = track_id
        entry["published_score"] = study["decision"]["score"]
        store.save_musician(name, entry)
    return track_id


@task(
    name="curate-peer-playlist",
    task_run_name="{name}-playlist",
    cache_policy=NO_CACHE,
    persist_result=False,
    retries=2,
    retry_delay_seconds=[2, 5],
)
def curate_peer(name: str, roster: dict, study: dict) -> None:
    if study["decision"]["add_to_playlist"]:
        curate(name, roster[name]["playlist_id"], roster[study["peer"]]["track_id"])


@flow(
    name="plyr.fm-musician-community",
    flow_run_name=lambda: (
        "plyr.fm-studio-" + datetime.now(UTC).strftime("%Y-%m-%d-%H%MZ")
    ),
    log_prints=True,
    persist_result=False,
    timeout_seconds=600,
)
def community(retry_failed: bool = False) -> Completed:
    directory = Path(os.environ["STUDIO_STATE_DIR"])
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "session.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return Completed(
                name="Skipped", message="Another studio session holds the worker lock"
            )
        store = Store(directory)
        session = store.reserve(datetime.now(UTC), retry_failed=retry_failed)
        if session is None:
            report_cost(store)
            return Completed(
                name="Skipped",
                message="Session slot or estimated budget limit reached",
            )
        try:
            roster = seed(directory)
            notes = []
            for name in roster:
                study = study_peer(directory, session, name, roster)
                path = render_study(directory, session, name, study)
                track = publish_study(directory, session, name, path, study)
                curate_peer(name, roster, study)
                decision = study["decision"]
                notes.append(
                    f"### {roster[name]['profile']['name']}\n\nStudied {study['peer_name']}.\n\n{decision['attraction']}\n\n{decision['disagreement']}\n\n{decision['changed']}\n\n[Playlist](https://plyr.fm/playlist/{roster[name]['playlist_id']})"
                    + (
                        f" · [New study](https://plyr.fm/track/{track})"
                        if track
                        else " · Daily upload cap reached"
                    )
                    + f"\n\nPeer probabilities: {json.dumps(study['probabilities'])}"
                )
            create_markdown_artifact(
                key="musician-community-progress",
                markdown=f"# Community session {session}\n\n" + "\n\n".join(notes),
            )
            store.finish(session, "completed")
        except BaseException:
            store.finish(session, "failed")
            raise
        finally:
            report_cost(store)
    return Completed(message="Persistent musician exchange completed")


def report_cost(store: Store) -> None:
    usage = store.usage(datetime.now(UTC))
    month = usage["month"]
    print(f"Studio cost ledger: {json.dumps(usage)}")
    create_markdown_artifact(
        key="plyr-fm-musician-costs",
        markdown=(
            "# Musician studio usage\n\n"
            f"This UTC month: {month['sessions']} sessions, {month['calls']} requests.\n\n"
            f"Pi-reported estimated model cost: ${month['estimated_cost']:.6f}.\n\n"
            f"Reserved/charged budget: ${month['budget_used']:.2f} / $5.00 monthly.\n\n"
            f"Today: ${usage['day']['budget_used']:.2f} / $0.20 reserved/charged.\n\n"
            "Budgets include failed reservations. Model costs are estimates, not provider invoices; "
            "worker hosting, storage, and account subscription costs are excluded. "
            "No model work starts when the next reservation would exceed a budget. "
            "The schedule resumes work in the next available budget window."
        ),
    )
