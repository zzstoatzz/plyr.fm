# ruff: noqa: RUF001, RUF002 — curly apostrophes in fixtures are the point
"""Keyword search ranks lexical intent above trigram fuzz (#1523).

The reported failure: typing "you don't kn" into add-tracks ranked the
exact-prefix title "you don’t know the shape i’m in (mj lenderman cover)"
fourth, below three short titles that merely shared trigrams. Bare
`similarity()` divides shared trigrams by the union of both strings' trigram
sets, so a long title is structurally punished for its length. These tests
pin the tiered ranking (exact > prefix > substring > fuzz) and the quote
normalization that lets straight and curly apostrophes find each other.
"""

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Artist, Track

ARTIST = "did:plc:searchranking"

# titles from the reported repro, curly apostrophes and all
TARGET = "you don’t know the shape i’m in (mj lenderman cover)"
DECOYS = ["I don't sled, I sleigh!", "12 Can't You See", "You can't escape"]


async def _seed(db: AsyncSession, titles: list[str]) -> None:
    db.add(Artist(did=ARTIST, handle="ranking.test", display_name="ranking"))
    await db.flush()
    for i, title in enumerate(titles):
        db.add(
            Track(
                title=title,
                artist_did=ARTIST,
                file_id=f"rank{i}",
                file_type="audio/mpeg",
                visibility="public",
            )
        )
    await db.commit()


async def _track_titles(query: str) -> list[str]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/search/", params={"q": query, "type": "tracks"})
    assert resp.status_code == 200
    return [r["title"] for r in resp.json()["results"]]


async def test_prefix_match_outranks_trigram_fuzz(db_session: AsyncSession) -> None:
    """The reported bug: a literal prefix of a long title lost to short fuzz."""
    await _seed(db_session, [TARGET, *DECOYS])
    titles = await _track_titles("you don't kn")
    assert titles[0] == TARGET, titles


async def test_quote_style_does_not_fracture_matching(
    db_session: AsyncSession,
) -> None:
    """Straight, curly, and absent apostrophes all find the curly-quoted title.

    Titles carry curly quotes from phone keyboards; queries arrive straight.
    Before normalization the curly-for-curly query still ranked the title
    fourth, and the no-apostrophe query dropped it entirely.
    """
    await _seed(db_session, [TARGET, *DECOYS])
    for query in ("you don't kn", "you don’t kn", "you dont kn"):
        titles = await _track_titles(query)
        assert titles and titles[0] == TARGET, (query, titles)


async def test_exact_match_outranks_a_longer_prefix_continuation(
    db_session: AsyncSession,
) -> None:
    await _seed(db_session, ["for you", "for you (demo)", "for your information"])
    titles = await _track_titles("for you")
    assert titles[0] == "for you", titles


async def test_fuzzy_matching_still_recalls_typos(db_session: AsyncSession) -> None:
    """Tiers must not cost the recall trigram search existed to provide."""
    await _seed(db_session, [TARGET, *DECOYS])
    titles = await _track_titles("lendermann")
    assert TARGET in titles, titles
