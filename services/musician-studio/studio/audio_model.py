"""Send rendered sound to a multimodal musician and retain host-side evidence."""

import base64
import hashlib
import json
import os
import subprocess
from pathlib import Path

import httpx
from pydantic import BaseModel, Field

from studio.context import musical_identity
from studio.identity import Musician
from studio.listening import ListeningReview, inspiration_digest, record_review
from studio.state import Store

MODEL = "gemini-3.5-flash"


class Feedback(BaseModel):
    observations: str = Field(min_length=20)
    changes: str = Field(min_length=10)
    ready: bool


def key() -> str:
    path = os.environ["STUDIO_CREDENTIALS_FILE"]
    raw = subprocess.run(
        ["sops", "-d", "--output-type", "json", path],
        capture_output=True,
        check=True,
        timeout=30,
    )
    values = json.loads(raw.stdout)
    return values.get("gemini_api_key") or values["local"]["gemini_api_key"]


def listen(
    store: Store,
    session: str,
    author: str,
    listener: str,
    path: Path,
    inspirations: list[dict],
) -> ListeningReview:
    profile = Musician.model_validate(store.musicians()[listener]["profile"])
    study = store.study(session, author) or {}
    prompt = (
        "Listen to the attached ten-second recording as this musician: "
        + json.dumps(musical_identity(profile))
        + ". The author's stated inspirations are: "
        + json.dumps(inspirations)
        + ". Review the audible tonality, pitch relationships, timbre, bass, balance, articulation, and development. "
        "Describe concrete audible moments and uncertainty; do not invent instrument names or infer sound from inspirations. "
        "First describe what you hear independently of the plan: is there a discernible pulse or intentional "
        "free rhythm, a motif with phrasing, coherent pitch relationships, and development? "
        "Name timestamps and uncertainty. Do not reward theory words or effects without audible organization. "
        "Then compare what you heard with the author's plan below; intentions are not evidence. "
        "Explain which musical relationship works or fails, and give an actionable note/rhythm/voicing "
        "or arrangement change rather than just more hiss, reverb or saturation. "
        "Judge percussion-led or non-tonal work by its stated organization, not compulsory chords. "
        "Suggest a specific revision to how it sounds. Ready means you would release it as the author, or keep it as a peer. "
        "A difference from your own taste is not a technical defect. Return JSON with observations, changes, and ready."
        + "\nAuthor's plan (may be absent for older work): "
        + json.dumps(study.get("musical_plan"))
    )
    data = path.read_bytes()
    if not data or len(data) > 4_000_000:
        raise ValueError("Missing or oversized review audio")
    store.call(session)
    with httpx.Client(timeout=90) as client:
        response = client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            headers={"x-goog-api-key": key()},
            json={
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": "audio/wav",
                                    "data": base64.b64encode(data).decode(),
                                }
                            },
                        ]
                    }
                ],
                "generationConfig": {
                    "maxOutputTokens": 1600,
                    "thinkingConfig": {"thinkingLevel": "LOW"},
                    "responseMimeType": "application/json",
                    "responseJsonSchema": Feedback.model_json_schema(),
                },
            },
        )
    if response.status_code != 200:
        raise RuntimeError(
            f"Audio review HTTP {response.status_code}; no text fallback"
        )
    result = response.json()
    usage = result["usageMetadata"]
    store.charge(
        session,
        (
            usage["promptTokenCount"] * 1.5
            + (
                usage.get("candidatesTokenCount", 0)
                + usage.get("thoughtsTokenCount", 0)
            )
            * 9
        )
        / 1_000_000,
    )
    audio_tokens = sum(
        v["tokenCount"]
        for v in usage.get("promptTokensDetails", [])
        if v["modality"] == "AUDIO"
    )
    candidate = result["candidates"][0]
    if candidate.get("finishReason") != "STOP":
        raise ValueError("Audio review was incomplete")
    feedback = Feedback.model_validate_json(
        "".join(
            p.get("text", "")
            for p in candidate["content"]["parts"]
            if not p.get("thought")
        )
    )
    review = ListeningReview(
        listener=listener,
        author=author,
        audio_sha256=hashlib.sha256(data).hexdigest(),
        model=result["modelVersion"],
        audio_tokens=audio_tokens,
        inspirations_sha256=inspiration_digest(inspirations),
        **feedback.model_dump(),
    )
    record_review(store, session, author, review)
    return review
