"""ats:// URI helpers for permissioned-data spaces.

a *space* URI has 3 segments and a *record* URI has 6 (space-first), per Daniel
Holmgren's permissioned-data diary 5:

    space:  ats://<spaceDid>/<spaceType>/<spaceKey>
    record: ats://<spaceDid>/<spaceType>/<spaceKey>/<authorDid>/<collection>/<rkey>
"""

from typing import NamedTuple

ATS_SCHEME = "ats://"


class SpaceUri(NamedTuple):
    owner_did: str
    space_type: str
    skey: str


class SpaceRecordUri(NamedTuple):
    space: str
    author_did: str
    collection: str
    rkey: str


def build_space_uri(owner_did: str, space_type: str, skey: str) -> str:
    return f"{ATS_SCHEME}{owner_did}/{space_type}/{skey}"


def build_record_uri(
    space_uri: str, author_did: str, collection: str, rkey: str
) -> str:
    return f"{space_uri}/{author_did}/{collection}/{rkey}"


def parse_space_uri(uri: str) -> SpaceUri:
    """parse the 3-segment space portion of an ats:// URI.

    accepts either a bare space URI or a full record URI (extra segments ignored).
    """
    if not uri.startswith(ATS_SCHEME):
        raise ValueError(f"not an ats:// URI: {uri!r}")
    segments = uri[len(ATS_SCHEME) :].split("/")
    if len(segments) < 3 or not all(segments[:3]):
        raise ValueError(f"space URI needs 3 non-empty segments: {uri!r}")
    return SpaceUri(owner_did=segments[0], space_type=segments[1], skey=segments[2])


def parse_space_record_uri(uri: str) -> SpaceRecordUri:
    """parse a full 6-segment permissioned-space record URI."""
    if not uri.startswith(ATS_SCHEME):
        raise ValueError(f"not an ats:// URI: {uri!r}")
    segments = uri[len(ATS_SCHEME) :].split("/")
    if len(segments) != 6 or not all(segments):
        raise ValueError(f"space record URI needs 6 non-empty segments: {uri!r}")
    return SpaceRecordUri(
        space=build_space_uri(segments[0], segments[1], segments[2]),
        author_did=segments[3],
        collection=segments[4],
        rkey=segments[5],
    )
