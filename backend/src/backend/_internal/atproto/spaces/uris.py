"""Canonical ``at://`` URI helpers for permissioned-data spaces.

A permissioned URI uses a fixed ``space`` marker after the authority DID, per
ATProto Proposal 0016:

    space:  at://<spaceDid>/space/<spaceType>/<spaceKey>
    record: at://<spaceDid>/space/<spaceType>/<spaceKey>/<authorDid>/<collection>/<rkey>
"""

from typing import NamedTuple

AT_SCHEME = "at://"
SPACE_MARKER = "space"


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
    return f"{AT_SCHEME}{owner_did}/{SPACE_MARKER}/{space_type}/{skey}"


def build_record_uri(
    space_uri: str, author_did: str, collection: str, rkey: str
) -> str:
    return f"{space_uri}/{author_did}/{collection}/{rkey}"


def parse_space_uri(uri: str) -> SpaceUri:
    """Parse the canonical space portion of a permissioned ``at://`` URI.

    accepts either a bare space URI or a full record URI (extra segments ignored).
    """
    if not uri.startswith(AT_SCHEME):
        raise ValueError(f"not an at:// URI: {uri!r}")
    segments = uri[len(AT_SCHEME) :].split("/")
    if len(segments) < 4 or not all(segments[:4]) or segments[1] != SPACE_MARKER:
        raise ValueError(f"invalid permissioned space URI: {uri!r}")
    return SpaceUri(owner_did=segments[0], space_type=segments[2], skey=segments[3])


def parse_space_record_uri(uri: str) -> SpaceRecordUri:
    """Parse a full canonical permissioned-space record URI."""
    if not uri.startswith(AT_SCHEME):
        raise ValueError(f"not an at:// URI: {uri!r}")
    segments = uri[len(AT_SCHEME) :].split("/")
    if len(segments) != 7 or not all(segments) or segments[1] != SPACE_MARKER:
        raise ValueError(f"invalid permissioned record URI: {uri!r}")
    return SpaceRecordUri(
        space=build_space_uri(segments[0], segments[2], segments[3]),
        author_did=segments[4],
        collection=segments[5],
        rkey=segments[6],
    )
