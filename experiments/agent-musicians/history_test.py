"""Check preference transfer to new scores without the assigned taste brief."""

import asyncio
import itertools
import json

from taste import OUT, SCORES, ask


async def main() -> None:
    prior = json.loads((OUT / "summary.json").read_text())["musicians"]
    new = {
        person: json.loads((OUT / f"{person}_peer.json").read_text())["answer"]["score"]
        for person in prior
    }

    async def evaluate(person: str) -> dict:
        ranked = sorted(
            prior[person]["wins"], key=prior[person]["wins"].get, reverse=True
        )
        history = [SCORES[name] for name in ranked]
        choices = []
        for i, (a, b) in enumerate(itertools.combinations(new, 2)):
            prompt = (
                "You are making a musical preference choice using a record of your earlier choices. "
                "You have not heard audio. Scores contain [pitch,onset seconds,duration seconds] events. "
                f"Previously preferred scores, from most to least preferred: {json.dumps(history)}. "
                "Choose which NEW score you would rather develop further. Do not simply count matching pitches; "
                "infer the musical preferences behind the earlier choices. Return ONLY JSON: choice (A or B), "
                "reason (one specific sentence), tradeoff (one specific sentence). "
                f"A: {json.dumps(new[a])} B: {json.dumps(new[b])}"
            )
            r = await ask(prompt, f"{person}_history_{i}")
            if r["answer"]["choice"] not in ("A", "B"):
                raise ValueError("Invalid choice")
            choices.append(a if r["answer"]["choice"] == "A" else b)
        return {"choices": choices, "wins": {name: choices.count(name) for name in new}}

    results = await asyncio.gather(*(evaluate(person) for person in prior))
    summary = dict(zip(prior, results, strict=True))
    (OUT / "history_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
