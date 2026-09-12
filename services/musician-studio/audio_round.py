"""Listen, revise, listen again, and exchange feedback before publication."""

from pathlib import Path

from prefect import task
from prefect.cache_policies import NO_CACHE
from prefect.context import FlowRunContext

from compose import Composition, compose
from studio.audio_model import listen
from studio.identity import Musician
from studio.listening import (
    ListeningReview,
    digest,
    require_listening,
)
from studio.render_repair import render_with_repair
from studio.state import Store


def reviewed(
    store: Store,
    session: str,
    author: str,
    listener: str,
    path: Path,
    inspirations: list[dict],
) -> ListeningReview:
    return listen(store, session, author, listener, path, inspirations)


@task(name="render-revision", cache_policy=NO_CACHE, persist_result=False)
def render_revision(
    piece: Composition, output: Path, directory: Path, session: str, name: str
) -> tuple[Composition, dict]:
    return render_with_repair(
        piece, output, Store(directory), session, name, "revision"
    )


def prepare_release(directory: Path, session: str, name: str, draft_path: Path) -> Path:
    store = Store(directory)
    study = store.study(session, name)
    profile = Musician.model_validate(store.musicians()[name]["profile"])
    inspirations = study.get("review_inspirations") or [
        i.model_dump() for i in profile.inspirations
    ]
    store.save_study(session, name, {"review_inspirations": inspirations})
    if not study.get("draft_audio_sha256"):
        feedback = reviewed(store, session, name, name, draft_path, inspirations)
        revision = compose(
            profile,
            [study],
            store,
            session,
            musician_id=name,
            revision=feedback.observations + "\n" + feedback.changes,
        )
        revised_path = directory / f"{session}-{name}" / "revision"
        renderer = render_revision if FlowRunContext.get() else render_revision.fn
        revision, metrics = renderer(revision, revised_path, directory, session, name)
        store.save_study(
            session,
            name,
            {
                **revision.model_dump(),
                "rendered": True,
                "metrics": metrics,
                "draft_audio_sha256": digest(draft_path),
                "audio_path": str((revised_path / "track.wav").relative_to(directory)),
            },
        )
    study = store.study(session, name)
    path = directory / study["audio_path"]
    own = reviewed(store, session, name, name, path, inspirations)
    names = sorted(store.musicians())
    peer_name = names[(names.index(name) + 1) % len(names)]
    peer = reviewed(store, session, name, peer_name, path, inspirations)
    store.save_study(
        session, name, {"audio_feedback": [own.model_dump(), peer.model_dump()]}
    )
    selected = study.get("peer")
    if selected:
        peer_study = store.study(selected["work"]["session"], selected["id"])
        peer_path = directory / peer_study.get(
            "audio_path",
            f"{selected['work']['session']}-{selected['id']}/audio/track.wav",
        )
        selection = reviewed(
            store, session, selected["id"], name, peer_path, selected["inspirations"]
        )
        store.save_study(
            session,
            name,
            {"keep_peer": selection.ready, "peer_note": selection.observations},
        )
    require_listening(
        store.study(session, name), name, path, store.listening_reviews(session, name)
    )
    return path
