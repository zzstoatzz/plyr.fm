"""Validated musical decisions; generated text never executes as code."""

import math
import random
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.identity import Taste


class Note(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pitch: str = Field(pattern=r"^[A-G]#?[345]$")
    start: float = Field(ge=0, lt=10)
    duration: float = Field(ge=0.1, le=10)

    @model_validator(mode="after")
    def ends_in_clip(self) -> "Note":
        if self.start + self.duration > 10:
            raise ValueError("Notes must finish within ten seconds")
        return self


class Score(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attack: float = Field(ge=0.005, le=1)
    release: float = Field(ge=0.02, le=2)
    lowpass: float = Field(ge=200, le=5000)
    events: Annotated[list[Note], Field(min_length=1, max_length=16)]


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=80)
    attraction: str = Field(min_length=1, max_length=400)
    disagreement: str = Field(min_length=1, max_length=400)
    changed: str = Field(min_length=1, max_length=400)
    memory: str = Field(min_length=1, max_length=600)
    add_to_playlist: bool
    taste: Taste
    score: Score


def select_peer(
    person: str, roster: dict, rng: random.Random
) -> tuple[str, dict[str, float]]:
    own = roster[person]["profile"]
    weights = {}
    for peer, entry in roster.items():
        if peer == person:
            continue
        distance = math.sqrt(
            sum(
                (own["taste"][k] - entry["profile"]["taste"][k]) ** 2
                for k in own["taste"]
            )
            / len(own["taste"])
        )
        curiosity = own["curiosity"]
        weights[peer] = (
            0.1 + (1 - curiosity) * math.exp(-3 * distance) + curiosity * distance
        )
    total = sum(weights.values())
    probabilities = {key: value / total for key, value in weights.items()}
    return rng.choices(list(weights), weights=list(weights.values()), k=1)[
        0
    ], probabilities
