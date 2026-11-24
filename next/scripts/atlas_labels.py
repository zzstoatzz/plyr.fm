"""name the atlas's sounds from what they sound like.

the clusters are built from CLAP audio embeddings, so their names come from
the same place: CLAP also embeds text into that space, which lets us ask
which plain descriptions ("dj mix", "acoustic guitar", "ambient drone") sit
closest to each cluster's tracks. the steps:

1. embed a fixed, neutral vocabulary of sound descriptions with CLAP's text
   encoder (the `SOUND_VOCAB` below, nothing else ever becomes a word in a
   name except a widely shared genre tag).
2. score every track against every description, and keep, per cluster, the
   descriptions that a real share of its member tracks lean towards (more
   than the rest of the catalog does). that share is the label's support.
3. haiku turns the supported descriptions into a 1-3 word name, choosing
   only from words it was given; anything else is rejected and the top
   supported description stands in.

titles never feed names, and tags that say how a track was made (ai, suno,
...) or judge it are dropped: a sound's name says how it sounds.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import httpx
import numpy as np

# neutral descriptions of sound: genre, form, instrument, texture. every word
# a name can use comes from here or from a tag many of the cluster's tracks share.
SOUND_VOCAB = [
    # electronic
    "ambient", "ambient drone", "dark ambient", "drone", "house", "deep house",
    "techno", "minimal techno", "trance", "drum and bass", "jungle",
    "breakbeat", "dubstep", "uk garage", "electro", "idm", "glitch",
    "synthwave", "synth pop", "electronic dance", "downtempo", "trip hop",
    "chillout", "chiptune", "hyperpop", "vaporwave", "noise", "industrial",
    "modular synth", "electronic beats",
    # hip hop and r&b
    "hip hop", "rap", "trap", "boom bap", "lo-fi hip hop", "instrumental beats",
    "r&b", "soul", "funk", "disco",
    # rock and guitar
    "rock", "indie rock", "alternative rock", "punk", "post-punk", "shoegaze",
    "post-rock", "metal", "heavy metal", "grunge", "garage rock",
    "psychedelic rock", "math rock", "emo", "surf rock", "blues",
    # acoustic and songs
    "folk", "indie folk", "singer-songwriter", "acoustic guitar", "country",
    "bluegrass", "americana", "pop", "indie pop", "bedroom pop", "dream pop",
    "ballad",
    # jazz and classical
    "jazz", "smooth jazz", "free jazz", "classical", "piano", "solo piano",
    "orchestral", "string quartet", "cinematic score", "choir", "opera",
    "chamber music",
    # world
    "reggae", "dub", "latin", "bossa nova", "afrobeat", "flamenco",
    # forms and recordings
    "dj mix", "live recording", "live band", "field recording",
    "spoken word", "podcast", "talking", "a cappella", "poetry reading",
    "sound effects", "nature sounds", "rain", "radio show", "demo recording",
    # instruments and voices
    "electric guitar", "distorted guitar", "bass guitar", "synthesizer",
    "drum machine", "drums", "percussion", "strings", "brass", "saxophone",
    "violin", "cello", "organ", "harp", "flute", "female vocals",
    "male vocals", "rapping", "singing", "humming",
    # texture and feel
    "calm", "dark", "bright", "upbeat", "slow", "fast", "heavy", "soft",
    "lush", "sparse", "distorted", "dreamy", "melancholy", "energetic",
    "warm", "lo-fi", "hazy", "eerie", "playful", "hypnotic", "groovy",
    "noisy", "glitchy", "chill", "intense", "gentle",
]  # fmt: skip

TEXT_PROMPTS = ["{}", "the sound of {}"]

# how a track was made, or a judgement of it: never a sound's name
PROCESS_WORDS = {
    "ai", "aimusic", "ai-music", "ai-generated", "generated", "suno", "udio",
    "riffusion", "musicgen", "slop", "ai-slop", "aislop", "gpt", "llm", "bot",
    "prompt", "neural", "diffusion", "model", "synthetic",
}  # fmt: skip
JUDGEMENT_WORDS = {
    "bad", "trash", "garbage", "junk", "cringe", "lame", "awful", "ugly",
    "worst", "crap", "shit", "shitty", "dumb", "stupid", "moonshine", "fake",
    "cheap", "generic", "best", "good", "great", "banger", "fire", "dope",
}  # fmt: skip
# tags that say nothing about sound
EMPTY_TAGS = {
    "music", "song", "songs", "track", "tracks", "new", "original", "demo",
    "untitled", "mix", "remix", "edit", "wip", "test", "plyr", "plyr.fm",
    "bluesky", "atproto", "other", "misc", "various", "unreleased", "single",
}  # fmt: skip
JOINERS = {"and", "&", "with", "of", "the", "for"}

MIN_SUPPORT = 0.3  # share of a cluster's tracks that must lean towards a description
MIN_TAG_SHARE = 0.3  # share of a cluster's tracks that must carry a tag
TOP_PER_TRACK = 12  # descriptions each track "leans towards"


def log(msg: str) -> None:
    print(msg, flush=True)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9&]+(?:-[a-z0-9]+)*", text.lower())


def sound_tag(tag: str) -> str | None:
    """a tag usable as sound evidence, normalised; None for process or empty tags."""
    t = " ".join(tag.lower().replace("_", " ").split()).strip("#")
    if not t or len(t) > 30 or t in EMPTY_TAGS:
        return None
    ws = words(t)
    if not ws or any(w in PROCESS_WORDS or w in JUDGEMENT_WORDS for w in ws):
        return None
    if all(w.isdigit() for w in ws):
        return None
    return t


@dataclass
class Evidence:
    """what a cluster's tracks have in common, for naming it."""

    count: int
    descriptions: list[tuple[str, float]]  # (description, support), best first
    tags: list[tuple[str, float]]  # (tag, share of tracks), most shared first
    allowed: set[str] = field(default_factory=set)


def embed_vocab(embed_text_url: str, timeout: float = 120) -> np.ndarray | None:
    """CLAP text vectors for SOUND_VOCAB (rows normalised), or None if unreachable."""

    def one(text: str) -> list[float]:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(embed_text_url, json={"text": text})
            resp.raise_for_status()
            vector = resp.json().get("embedding")
            if not vector:
                raise ValueError("no embedding")
            return vector

    texts = [p.format(term) for term in SOUND_VOCAB for p in TEXT_PROMPTS]
    try:
        one(texts[0])  # wake the endpoint before fanning out
        with ThreadPoolExecutor(8) as pool:
            vectors = np.array(list(pool.map(one, texts)), dtype=np.float64)
    except (httpx.HTTPError, ValueError) as e:
        log(f"  CLAP text endpoint failed ({type(e).__name__}); naming from tags only")
        return None
    vectors = vectors.reshape(len(SOUND_VOCAB), len(TEXT_PROMPTS), -1).mean(axis=1)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def track_leanings(X: np.ndarray, vocab_vecs: np.ndarray) -> np.ndarray:
    """bool [tracks, vocab]: the descriptions each track sits closest to, relative
    to how close the whole catalog sits (so 'music'-ish terms don't win everywhere)."""
    Xn = X / np.linalg.norm(X, axis=1, keepdims=True)
    sims = Xn @ vocab_vecs.T
    lift = sims - sims.mean(axis=0)
    top = np.argsort(-lift, axis=1)[:, :TOP_PER_TRACK]
    lean = np.zeros_like(sims, dtype=bool)
    np.put_along_axis(lean, top, True, axis=1)
    return lean


def gather_evidence(
    labels: np.ndarray,
    core: np.ndarray,
    tags_per_track: list[list[str]],
    lean: np.ndarray | None,
) -> dict[int, Evidence]:
    """per cluster: supported descriptions and widely shared sound tags.
    support is measured over the cluster's core tracks (HDBSCAN's own members)."""
    out: dict[int, Evidence] = {}
    for cid in sorted({int(c) for c in labels}):
        members = labels == cid
        core_members = members & core
        if core_members.sum() < 3:
            core_members = members
        n = int(core_members.sum())
        descriptions: list[tuple[str, float]] = []
        if lean is not None:
            support = lean[core_members].mean(axis=0)
            order = np.argsort(-support)
            descriptions = [
                (SOUND_VOCAB[j], round(float(support[j]), 3))
                for j in order[:10]
                if support[j] >= MIN_SUPPORT
            ]
        tag_counts: dict[str, int] = {}
        for i in np.flatnonzero(core_members):
            for t in {sound_tag(t) for t in tags_per_track[i]} - {None}:
                tag_counts[t] = tag_counts.get(t, 0) + 1
        tags = sorted(
            (
                (t, round(c / n, 3))
                for t, c in tag_counts.items()
                if c / n >= MIN_TAG_SHARE and c >= 2
            ),
            key=lambda tc: -tc[1],
        )[:6]
        allowed = {w for d, _ in descriptions for w in words(d)}
        allowed |= {w for t, _ in tags for w in words(t)}
        out[cid] = Evidence(int(members.sum()), descriptions, tags, allowed)
    return out


def fallback_name(ev: Evidence, taken: set[str]) -> str:
    """the best-supported description (or tag), widened until it's unique."""
    scored = sorted(ev.descriptions + ev.tags, key=lambda ds: -ds[1])
    pool = [d for d, _ in scored]
    if not pool:
        return "mixed sounds"
    name = pool[0]
    for extra in pool[1:]:
        if name not in taken:
            break
        name = f"{pool[0]} {extra}" if len(words(pool[0] + " " + extra)) <= 4 else extra
    return name


def valid_name(name: str, ev: Evidence) -> bool:
    ws = words(name)
    return (
        0 < len(ws) <= 4
        and all(w in ev.allowed or w in JOINERS for w in ws)
        and not any(w in PROCESS_WORDS or w in JUDGEMENT_WORDS for w in ws)
        and any(w not in JOINERS for w in ws)
    )


SYSTEM = (
    "You name regions of a sound map. Each region is a group of audio tracks "
    "that sound alike (grouped by an audio model, not by text).\n\n"
    "For each region you get descriptions an audio model matched to its tracks, "
    "with support (the share of the region's tracks that lean towards it), and tags "
    "many of its tracks share, with their share.\n\n"
    "Write a plain name of 1-3 lowercase words that says what the region sounds "
    "like, so a listener would nod. Rules:\n"
    "- use ONLY words that appear in that region's descriptions or tags\n"
    "- prefer the best-supported evidence; combine two pieces only if both are well "
    "supported (e.g. 'dark ambient drone', 'acoustic folk', 'dj mix')\n"
    "- be neutral and descriptive: no judgement, no jokes, no puns, nothing about "
    "how tracks were made\n"
    "- every region's name must differ from the others\n\n"
    "Respond with ONLY a JSON object mapping region id (as string) to name."
)


def haiku_names(evidence: dict[int, Evidence], api_key: str) -> dict[int, str]:
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    parts = []
    for cid, ev in evidence.items():
        desc = ", ".join(f"{d} ({s:.0%})" for d, s in ev.descriptions) or "none"
        tags = ", ".join(f"{t} ({s:.0%})" for t, s in ev.tags) or "none"
        parts.append(
            f"Region {cid} ({ev.count} tracks)\n  sounds: {desc}\n  tags: {tags}"
        )
    resp = client.messages.create(
        model="claude-haiku-5-5",
        max_tokens=4096,
        system=SYSTEM,
        messages=[{"role": "user", "content": "\n\n".join(parts)}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return {int(k): str(v).strip().lower() for k, v in json.loads(text).items()}
    except (json.JSONDecodeError, ValueError, AttributeError):
        log("  warning: couldn't parse haiku's names; using descriptions")
        return {}


def name_clusters(
    evidence: dict[int, Evidence], api_key: str, tier: str
) -> dict[int, str]:
    """a checked, unique, neutral name per cluster."""
    proposed: dict[int, str] = {}
    if api_key and any(ev.descriptions or ev.tags for ev in evidence.values()):
        try:
            proposed = haiku_names(evidence, api_key)
        except Exception as e:  # noqa: BLE001 - names fall back to descriptions
            log(f"  haiku naming failed ({type(e).__name__}); using descriptions")
    names: dict[int, str] = {}
    rejected = 0
    # best-evidenced clusters claim their names first
    for cid in sorted(evidence, key=lambda c: -evidence[c].count):
        ev = evidence[cid]
        name = proposed.get(cid, "")
        if not valid_name(name, ev) or name in names.values():
            if name:
                rejected += 1
                log(f"  {tier} {cid}: rejected {name!r}")
            name = fallback_name(ev, set(names.values()))
        names[cid] = name
    log(f"  {tier}: named {len(names)} sounds ({rejected} proposals rejected)")
    return names


def previous_names(
    previous: dict | None, tier: str, points: list[dict]
) -> dict[int, str]:
    """for a before/after log: each new cluster's name in the stored map, matched
    by where most of its tracks were."""
    if not previous:
        return {}
    key = "clusterCoarse" if tier == "coarse" else "clusterFine"
    old_label = {
        c["id"]: c["label"] for c in previous.get("clusters", {}).get(tier, [])
    }
    old_of = {p["id"]: p.get(key) for p in previous.get("points", [])}
    votes: dict[int, dict[int, int]] = {}
    for p in points:
        old = old_of.get(p["id"])
        if old is not None:
            votes.setdefault(p[key], {}).setdefault(old, 0)
            votes[p[key]][old] += 1
    return {cid: old_label.get(max(v, key=v.get), "?") for cid, v in votes.items() if v}


def report(
    tier: str,
    names: dict[int, str],
    evidence: dict[int, Evidence],
    before: dict[int, str],
    samples: dict[int, list[str]],
) -> str:
    """markdown table of names with their evidence, for logs and the job summary."""
    rows = [
        f"### {tier} sounds",
        "",
        "| before | after | tracks | sounds (support) | tags | sample tracks |",
        "|---|---|---|---|---|---|",
    ]
    for cid in sorted(names, key=lambda c: -evidence[c].count):
        ev = evidence[cid]
        desc = ", ".join(f"{d} {s:.0%}" for d, s in ev.descriptions[:4])
        tags = ", ".join(f"{t} {s:.0%}" for t, s in ev.tags[:3])
        sample = "; ".join(samples.get(cid, [])[:3]).replace("|", "/")
        rows.append(
            f"| {before.get(cid, '')} | **{names[cid]}** | {ev.count} | {desc} | {tags} | {sample} |"
        )
    return "\n".join(rows) + "\n"
