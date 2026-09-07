"""Bounded, attributable musical history for each composition request."""

import json
import math
import random

from studio.identity import Musician
from studio.state import Store


def musical_identity(profile: Musician) -> dict:
    return profile.model_dump(exclude={"avatar_prompt", "bio"})


def history_context(history: list[dict], byte_limit: int = 18000) -> list[dict]:
    selected = []
    for entry in history:
        item = {
            key: entry[key]
            for key in (
                "session",
                "title",
                "idea",
                "python",
                "memory",
                "metrics",
                "track_id",
            )
            if key in entry
        }
        if len(json.dumps(selected + [item]).encode()) <= byte_limit:
            selected.append(item)
        elif not selected:
            item.pop("python", None)
            item["code_omitted"] = "Source exceeded the history byte budget"
            if len(json.dumps([item]).encode()) <= byte_limit:
                selected.append(item)
    return selected


def choose_peer(store: Store, name: str, session: str) -> dict | None:
    roster = store.musicians()
    own = Musician.model_validate(roster[name]["profile"])
    candidates = {}
    weights = {}
    for key, entry in roster.items():
        if key == name:
            continue
        history = store.history(key, session, published=True)
        if not history:
            continue
        peer = Musician.model_validate(entry["profile"])
        distance = math.sqrt(
            sum(
                (value - peer.taste.model_dump()[dim]) ** 2
                for dim, value in own.taste.model_dump().items()
            )
            / 7
        )
        weights[key] = (
            0.1
            + (1 - own.curiosity) * math.exp(-3 * distance)
            + own.curiosity * distance
        )
        candidates[key] = {
            "id": key,
            "name": peer.name,
            "inspirations": [i.model_dump() for i in peer.inspirations],
            "work": history_context(history[:1], 12000)[0],
        }
    if not weights:
        return None
    chosen = random.Random(f"{session}:{name}").choices(
        list(weights), weights=list(weights.values())
    )[0]
    return {
        **candidates[chosen],
        "probabilities": {
            key: value / sum(weights.values()) for key, value in weights.items()
        },
    }
