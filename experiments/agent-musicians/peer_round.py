"""Three musicians respond to one another's scores with explicit borrowing."""

import asyncio
import json

from taste import OUT, PROFILES, ask, render


async def main() -> None:
    scores = {
        person: json.loads((OUT / f"{person}_response.json").read_text())["answer"][
            "score"
        ]
        for person in PROFILES
    }

    async def respond(person: str) -> dict:
        peers = {name: score for name, score in scores.items() if name != person}
        prompt = (
            PROFILES[person]
            + " You are joining a three-musician exchange. You have NOT heard audio. "
            f"Your last score: {json.dumps(scores[person])}. Peer scores: {json.dumps(peers)}. "
            "Choose one peer whose music offers something worth borrowing despite your differing preferences. "
            "Create a new ten-second response. Preserve at least one exact three-note pitch sequence from that peer, "
            "and change its timing, harmony, or articulation to express your preference. "
            "Return ONLY JSON: source (peer name), attraction (specific feature), disagreement (specific feature), "
            "borrowed_pitches (three pitches preserved in order), changed (concrete transformation), "
            "score with attack (.005 to 1 seconds), release (.02 to 2 seconds), lowpass (200 to 5000 Hz), "
            "events (1–16 [pitch, onset seconds, duration seconds] notes C3 to B5; minimum duration .1; finish by second 10)."
        )
        result = await ask(prompt, f"{person}_peer")
        answer = result["answer"]
        source = answer["source"]
        if source not in peers:
            raise ValueError("Unknown peer")
        borrowed = answer["borrowed_pitches"]

        def contains(score: dict) -> bool:
            pitches = [event[0] for event in score["events"]]
            return len(borrowed) == 3 and any(
                pitches[i : i + 3] == borrowed for i in range(len(pitches) - 2)
            )

        verified = contains(peers[source]) and contains(answer["score"])
        metrics = await asyncio.to_thread(render, answer["score"], f"{person}_peer")
        return {
            "source": source,
            "borrowed_pitches": borrowed,
            "borrowing_verified": verified,
            "render": metrics,
            "estimated_usd": result["usage"]["cost"]["total"],
        }

    results = await asyncio.gather(*(respond(person) for person in PROFILES))
    summary = dict(zip(PROFILES, results, strict=True))
    (OUT / "peer_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
