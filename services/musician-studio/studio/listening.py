"""Host-recorded audio evidence required before a studio release."""

import hashlib
import json
from pathlib import Path

from pydantic import BaseModel, Field

from studio.state import Store


class NotReady(ValueError):
    pass


class ListeningReview(BaseModel):
    listener: str
    author: str
    audio_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    model: str = Field(min_length=1)
    audio_tokens: int = Field(gt=0)
    inspirations_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    observations: str = Field(min_length=20)
    changes: str = Field(min_length=10)
    ready: bool


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspiration_digest(inspirations: list[dict]) -> str:
    if not inspirations:
        raise ValueError("Listening requires the author's stated inspirations")
    return hashlib.sha256(json.dumps(inspirations, sort_keys=True).encode()).hexdigest()


def require_listening(study: dict, name: str, path: Path, reviews: list[dict]) -> None:
    draft = study.get("draft_audio_sha256")
    final = digest(path)
    if not draft or draft == final:
        raise ValueError("Publishing requires a rendered revision after self-review")
    inspirations = inspiration_digest(study.get("review_inspirations", []))
    evidence = [ListeningReview.model_validate(value) for value in reviews]
    own_draft = any(
        r.listener == name
        and r.author == name
        and r.audio_sha256 == draft
        and r.inspirations_sha256 == inspirations
        for r in evidence
    )
    own_final = any(
        r.listener == name
        and r.author == name
        and r.audio_sha256 == final
        and r.inspirations_sha256 == inspirations
        for r in evidence
    )
    peer_final = any(
        r.listener != name
        and r.author == name
        and r.audio_sha256 == final
        and r.inspirations_sha256 == inspirations
        for r in evidence
    )
    if not (own_draft and own_final and peer_final):
        raise ValueError(
            "Publishing requires audio self-review, revision review, and peer feedback"
        )
    if not any(
        r.listener == name
        and r.author == name
        and r.audio_sha256 == final
        and r.inspirations_sha256 == inspirations
        and r.ready
        for r in evidence
    ):
        raise NotReady(
            "The musician requested another revision; keeping this piece unpublished"
        )


def record_review(
    store: Store, session: str, name: str, review: ListeningReview
) -> None:
    with store.connect() as db:
        db.execute(
            "INSERT INTO listening_reviews VALUES (?,?,?)",
            (session, name, review.model_dump_json()),
        )
