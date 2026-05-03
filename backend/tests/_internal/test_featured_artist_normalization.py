"""regression tests for the featured-artist DID normalization fix.

zzstoatzz/plyr.fm#1355: track features were stored as a denormalized
snapshot (`{did, handle, displayName|display_name, avatar_url}`) which
drifted on profile changes AND on case convention (the ingest path
wrote camelCase, the upload path wrote snake_case). 3 prod tracks
ended up with `displayName`-only entries that the frontend (which
reads `display_name`) rendered as a blank "feat." badge.

after the fix:
- `track.features` stores ONLY DIDs as `[{"did": "..."}, ...]`
- ingest extracts DIDs from any historical shape (snake, camel, or
  flat string) and discards the rest
- API responses hydrate from the DID via the profile resolver
"""

from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.profiles import ResolvedProfile
from backend._internal.tasks.ingest import _features_to_did_list
from backend.models import Artist

# --- _features_to_did_list: tolerates every historical shape -----------


def test_features_extracts_dids_from_camelcase_lexicon_shape() -> None:
    """ingest of a PDS record with the lexicon's camelCase shape keeps only the DID."""
    pds_record_features = [
        {
            "did": "did:plc:t44345nyd7jmxfs5hxs4doch",
            "handle": "whereditgo.diamonds",
            "displayName": "incognitothief",
        }
    ]
    assert _features_to_did_list(pds_record_features) == [
        {"did": "did:plc:t44345nyd7jmxfs5hxs4doch"}
    ]


def test_features_extracts_dids_from_snake_case_shape() -> None:
    """legacy DB rows that used snake_case + avatar are also normalized to DID-only."""
    legacy_db_features = [
        {
            "did": "did:plc:abc",
            "handle": "alice.example",
            "display_name": "Alice",
            "avatar_url": "https://cdn/.../avatar.jpg",
        }
    ]
    assert _features_to_did_list(legacy_db_features) == [{"did": "did:plc:abc"}]


def test_features_extracts_dids_from_flat_string_shape() -> None:
    """forward-compat: tolerate `["did:plc:..."]` even though we don't write it."""
    assert _features_to_did_list(["did:plc:abc", "did:plc:xyz"]) == [
        {"did": "did:plc:abc"},
        {"did": "did:plc:xyz"},
    ]


def test_features_handles_mixed_input() -> None:
    """one bad apple shouldn't drop the rest."""
    mixed = [
        {"did": "did:plc:good1", "handle": "h"},
        {"handle": "no-did-here"},  # malformed, drop
        "did:plc:good2",
        {"did": ""},  # empty did, drop
        None,  # also drop
    ]
    assert _features_to_did_list(mixed) == [
        {"did": "did:plc:good1"},
        {"did": "did:plc:good2"},
    ]


def test_features_empty_inputs() -> None:
    assert _features_to_did_list(None) == []
    assert _features_to_did_list([]) == []


# --- _hydrate_features: API view comes from the resolver, not raw DB ---


async def test_hydrate_features_renames_camelcase_via_resolver(
    db_session: AsyncSession,
) -> None:
    """the visible bug from #1355: a DB row with `displayName` (camelCase)
    used to render blank because the frontend reads `display_name`. the
    resolver now drives the API output, so the camelCase blob in the DB
    becomes irrelevant — `display_name` is always populated from the
    artist's current profile.
    """
    # set up a featured artist in the artists table — the resolver
    # finds them via the JOIN path and returns their current profile
    db_session.add(
        Artist(
            did="did:plc:resolvertest",
            handle="resolved.example",
            display_name="Resolver Test",
            avatar_url="https://example/avatar.jpg",
        )
    )
    await db_session.commit()

    # legacy DB row with the case-mismatch bug — `displayName` not `display_name`
    legacy_features = [
        {
            "did": "did:plc:resolvertest",
            "handle": "stale-handle.example",  # what was true at ingest time
            "displayName": "Stale Display Name",
        }
    ]

    from backend.schemas import _hydrate_features

    hydrated = await _hydrate_features(legacy_features)
    assert len(hydrated) == 1
    [view] = hydrated
    assert view.did == "did:plc:resolvertest"
    assert (
        view.display_name == "Resolver Test"
    )  # from artists table, NOT the stale snapshot
    assert view.handle == "resolved.example"
    assert view.avatar_url == "https://example/avatar.jpg"


async def test_hydrate_features_handles_unknown_did_via_bsky_fallback() -> None:
    """when a featured DID isn't a plyr.fm artist, fall back to bsky getProfile."""
    from backend.schemas import _hydrate_features

    # mock the bsky fetch path — we don't want a real network call in tests
    with patch(
        "backend._internal.atproto.profiles._fetch_from_bsky",
        new=AsyncMock(
            return_value=ResolvedProfile(
                did="did:plc:unknownuser",
                handle="bsky-only.example",
                display_name="Not A Plyr User",
                avatar_url=None,
            )
        ),
    ):
        # also clear the in-process cache so the fallback path runs
        from backend._internal.atproto import profiles as profiles_module

        profiles_module._cache.clear()

        hydrated = await _hydrate_features([{"did": "did:plc:unknownuser"}])

    assert len(hydrated) == 1
    [view] = hydrated
    assert view.handle == "bsky-only.example"
    assert view.display_name == "Not A Plyr User"


async def test_hydrate_features_empty_list_skips_resolution() -> None:
    """no DIDs → no resolver call, no DB hit."""
    from backend.schemas import _hydrate_features

    # if this called resolve_dids, the patched function below would raise
    with patch(
        "backend._internal.atproto.profiles.resolve_dids",
        new=AsyncMock(side_effect=AssertionError("should not be called")),
    ):
        assert await _hydrate_features(None) == []
        assert await _hydrate_features([]) == []


async def test_hydrate_features_drops_unresolvable_did() -> None:
    """DIDs that bsky can't resolve are silently dropped — no placeholder.

    rationale in `_internal.atproto.profiles` module docstring: a featured
    artist whose profile we can't load is better not shown than shown as
    a raw `did:plc:...` string.
    """
    from backend._internal.atproto import profiles as profiles_module
    from backend.schemas import _hydrate_features

    profiles_module._cache.clear()
    with patch(
        "backend._internal.atproto.profiles._fetch_from_bsky",
        new=AsyncMock(return_value=None),
    ):
        hydrated = await _hydrate_features(
            [{"did": "did:plc:gone1"}, {"did": "did:plc:gone2"}]
        )

    assert hydrated == []
