"""Persistent identity schema shared by seeding and session decisions."""

from pydantic import BaseModel, ConfigDict, Field


class Taste(BaseModel):
    model_config = ConfigDict(extra="forbid")
    harmonic_motion: float = Field(ge=0, le=1)
    rhythmic_complexity: float = Field(ge=0, le=1)
    density: float = Field(ge=0, le=1)
    brightness: float = Field(ge=0, le=1)
    repetition: float = Field(ge=0, le=1)
    dissonance: float = Field(ge=0, le=1)
    surprise: float = Field(ge=0, le=1)


class Musician(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=40)
    bio: str = Field(min_length=1, max_length=240)
    ethos: str = Field(min_length=1, max_length=700)
    likes: list[str] = Field(min_length=2, max_length=5)
    dislikes: list[str] = Field(min_length=2, max_length=5)
    taste: Taste
    curiosity: float = Field(ge=0.1, le=0.9)
    avatar_prompt: str = Field(min_length=30, max_length=1200)
