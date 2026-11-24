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
    "techno", "minimal techno", "drum and bass", "breakbeat", "glitch",
    "synthwave", "electronic dance", "downtempo", "trip hop", "noise",
    "modular synth", "electronic beats",
    # hip hop and r&b
    "hip hop", "rap", "lo-fi hip hop", "instrumental beats", "r&b", "soul",
    "funk", "disco",
    # rock and guitar
    "rock", "indie rock", "psychedelic rock", "punk", "post-rock",
    "shoegaze", "blues", "jam band",
    # acoustic and songs
    "folk", "indie folk", "singer-songwriter", "country", "pop", "indie pop",
    "dream pop",
    # jazz and classical
    "jazz", "classical", "piano", "solo piano", "orchestral",
    "string quartet", "chamber music", "cinematic score", "choir",
    # forms and recordings
    "dj mix", "live recording", "live band", "field recording",
    "spoken word", "podcast", "talking", "demo recording",
    # instruments and voices
    "acoustic guitar", "electric guitar", "distorted guitar", "synthesizer",
    "drum machine", "drums", "strings", "brass", "saxophone", "violin",
    "fiddle", "banjo", "organ", "female vocals", "male vocals", "singing",
    "rapping",
    # texture and feel
    "calm", "dark", "slow", "soft", "dreamy", "melancholy", "upbeat",
    "energetic", "hazy", "eerie", "heavy", "lo-fi", "warm", "groovy",
    "hypnotic",
]  # fmt: skip
# CLAP's text side is weak on niche genre names (it heard dj mixes as
# "afrobeat" and radiators as "metal"), so the vocabulary sticks to broad
# genres, forms, instruments and feel it places reliably.

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

MIN_SUPPORT = 0.4  # share of a cluster's tracks that must lean towards a description
MIN_TAG_SHARE = 0.3  # share of a cluster's tracks that must carry a tag
TOP_PER_TRACK = 8  # descriptions each track "leans towards"


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
    titles: list[str] = field(default_factory=list)  # context only, never words

    def phrases(self) -> list[str]:
        return [d for d, _ in self.descriptions] + [t for t, _ in self.tags]


def embed_vocab(embed_text_url: str) -> np.ndarray | None:
    """CLAP text vectors for SOUND_VOCAB (rows normalised), or None if unreachable.
    the first call waits out a cold start (the model loads for minutes); the rest
    go one at a time so modal doesn't cold-start more containers for them."""
    texts = [p.format(term) for term in SOUND_VOCAB for p in TEXT_PROMPTS]
    vectors = []
    try:
        with httpx.Client(timeout=60) as client:
            for i, text in enumerate(texts):
                for attempt in range(3 if i == 0 else 2):
                    try:
                        resp = client.post(
                            embed_text_url,
                            json={"text": text},
                            timeout=600 if i == 0 else 60,
                        )
                        resp.raise_for_status()
                        break
                    except httpx.TransportError:
                        if attempt == (2 if i == 0 else 1):
                            raise
                vector = resp.json().get("embedding")
                if not vector:
                    raise ValueError("no embedding")
                vectors.append(vector)
    except (httpx.HTTPError, ValueError) as e:
        log(f"  CLAP text endpoint failed ({type(e).__name__})")
        return None
    arr = np.array(vectors, dtype=np.float64)
    arr = arr.reshape(len(SOUND_VOCAB), len(TEXT_PROMPTS), -1).mean(axis=1)
    log(f"  embedded {len(SOUND_VOCAB)} sound descriptions")
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


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
    titles: list[str] | None = None,
) -> dict[int, Evidence]:
    """per cluster: supported descriptions and widely shared sound tags.
    support is measured over the cluster's core tracks (HDBSCAN's own members)."""
    out: dict[int, Evidence] = {}
    cids = sorted({int(c) for c in labels})
    if lean is not None:
        typical = np.median(
            np.array(
                [
                    lean[(labels == c) & core].mean(axis=0)
                    if ((labels == c) & core).sum() >= 3
                    else lean[labels == c].mean(axis=0)
                    for c in cids
                ]
            ),
            axis=0,
        )
    for cid in cids:
        members = labels == cid
        core_members = members & core
        if core_members.sum() < 3:
            core_members = members
        n = int(core_members.sum())
        descriptions: list[tuple[str, float]] = []
        if lean is not None:
            support = lean[core_members].mean(axis=0)
            # rank by how much more this cluster leans towards a description
            # than clusters usually do, so names say what sets it apart
            distinct = support - typical
            order = np.argsort(-distinct)
            descriptions = [
                (SOUND_VOCAB[j], round(float(support[j]), 3))
                for j in order
                if support[j] >= MIN_SUPPORT and distinct[j] > 0
            ][:8]
            # a broad cluster may stand out on little; its most shared sounds count too
            if len(descriptions) < 4:
                have = {d for d, _ in descriptions}
                for j in np.argsort(-support):
                    if len(descriptions) >= 6 or support[j] < MIN_SUPPORT:
                        break
                    if SOUND_VOCAB[j] not in have:
                        descriptions.append(
                            (SOUND_VOCAB[j], round(float(support[j]), 3))
                        )
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
        sample = []
        if titles:
            idx = np.flatnonzero(core_members)
            pick = np.random.default_rng(cid).choice(
                idx, size=min(10, len(idx)), replace=False
            )
            sample = [titles[i] for i in sorted(pick)]
        out[cid] = Evidence(int(members.sum()), descriptions, tags, sample)
    return out


def fallback_name(ev: Evidence, taken: set[str]) -> str:
    """the most distinctive phrase, joined with a later one until it's unique."""
    pool = ev.phrases()
    if not pool:
        return "mixed sounds"
    first = pool[0]
    options = [first] + [
        f"{first} {extra}"
        for extra in pool[1:]
        if not set(words(extra)) & set(words(first))
    ]
    return next((o for o in options if o not in taken), first)


def valid_name(name: str, ev: Evidence) -> bool:
    """one of the cluster's phrases, or two of them joined (in either order)."""
    name = " ".join(words(name))
    ws = words(name)
    if len(set(ws)) < len(ws) or any(
        w in PROCESS_WORDS or w in JUDGEMENT_WORDS for w in ws
    ):
        return False
    phrases = [" ".join(words(p)) for p in ev.phrases()]
    if name in phrases:
        return True
    for a in phrases:
        for b in phrases:
            if a != b and name in (f"{a} {b}", f"{a} and {b}", f"{a} & {b}"):
                return True
    # a shared word may merge: "acoustic guitar" + "blues" → "acoustic blues guitar"
    pairs = {frozenset(words(f"{a} {b}")) for a in phrases for b in phrases if a != b}
    return len(words(name)) <= 4 and frozenset(words(name)) in pairs


SYSTEM = (
    "You name a region of a sound map: a group of audio tracks that sound alike "
    "(grouped by an audio model, not by text).\n\n"
    "You get candidate descriptions an audio model matched to the region's tracks, "
    "most distinctive first, with support (the share of its tracks that lean towards "
    "it); tags many of its tracks share; and some track titles. The audio model is "
    "noisy, so use the titles and tags to judge which candidates are true: a title "
    "like 'voice memo', 'episode' or 'update' means speech, so 'dj mix' or 'modular "
    "synth' would be wrong there; 'mix' or a venue and date means a dj set or a live "
    "recording.\n\n"
    "Give your three best names, best first. Each is ONE candidate, or two candidates "
    "joined (e.g. 'dj mix', 'acoustic guitar', 'dark ambient drone'), copied exactly. "
    "Never use a word that isn't in the candidates or tags: titles are context only. "
    "Prefer one candidate over two; never repeat a word. For speech, prefer 'spoken "
    "word', 'podcast' or 'talking'; name a region by voice ('male vocals', 'female "
    "vocals') only when nothing else fits. Be neutral and descriptive: "
    "no judgement, no jokes, nothing about how tracks were made.\n\n"
    'Respond with ONLY a JSON array of three strings, like ["dj mix", "techno", '
    '"house dj mix"].'
)


def haiku_names(evidence: dict[int, Evidence], api_key: str) -> dict[int, list[str]]:
    """haiku's ranked names per cluster, one request each (a long batch drifts)."""
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)

    def ask(cid: int) -> list[str]:
        ev = evidence[cid]
        desc = ", ".join(f"{d} ({s:.0%})" for d, s in ev.descriptions) or "none"
        tags = ", ".join(f"{t} ({s:.0%})" for t, s in ev.tags) or "none"
        titles = "; ".join(ev.titles) or "none"
        prompt = f"candidates: {desc}\ntags: {tags}\ntitles: {titles}"
        try:
            resp = client.messages.create(
                model="claude-haiku-5-5",
                max_tokens=200,
                system=SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(b.text for b in resp.content if b.type == "text")
            found = re.search(r"\[.*?\]", text, re.DOTALL)
            names = json.loads(found.group(0)) if found else []
            return [str(n).strip().lower() for n in names if isinstance(n, str)]
        except Exception as e:  # noqa: BLE001 - one cluster falls back alone
            log(f"  haiku failed for {cid} ({type(e).__name__})")
            return []

    with ThreadPoolExecutor(6) as pool:
        return dict(zip(evidence, pool.map(ask, evidence)))


def name_clusters(
    evidence: dict[int, Evidence], api_key: str, tier: str
) -> dict[int, str]:
    """a checked, unique, neutral name per cluster."""
    proposed: dict[int, list[str]] = {}
    if api_key and any(ev.phrases() for ev in evidence.values()):
        proposed = haiku_names(evidence, api_key)
    names: dict[int, str] = {}
    rejected = 0
    # best-evidenced clusters claim their names first
    for cid in sorted(evidence, key=lambda c: -evidence[c].count):
        ev = evidence[cid]
        taken = set(names.values())
        name = ""
        for option in proposed.get(cid, []):
            if valid_name(option, ev) and option not in taken:
                name = option
                break
            rejected += 1
            log(f"  {tier} {cid}: passed over {option!r}")
        names[cid] = name or fallback_name(ev, taken)
    log(f"  {tier}: named {len(names)} sounds ({rejected} proposals passed over)")
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
