"""client for slingshot, microcosm's atproto identity + record edge cache.

we use it for verified DID → handle/PDS resolution. jetstream `#identity`
events carry no handle — the payload is just `{did, seq, time}` — so on an
identity change we resolve the current verified miniDoc here rather than
trusting the event.

public instance: https://slingshot.microcosm.blue
source: https://github.com/at-microcosm/microcosm-rs/tree/main/slingshot
"""

import logging
from typing import TypedDict

import httpx
from atproto_oauth.security import is_safe_url

logger = logging.getLogger(__name__)

SLINGSHOT_URL = "https://slingshot.microcosm.blue"
USER_AGENT = "plyr.fm (zzstoatzz.io)"


class UnsafePdsEndpoint(ValueError):
    """raised when a resolved miniDoc names a PDS we will not talk to."""


class MiniDoc(TypedDict):
    """verified identity summary returned by resolveMiniDoc."""

    did: str
    handle: str
    pds: str
    signing_key: str


async def resolve_mini_doc(did: str) -> MiniDoc:
    """resolve a DID to its current verified handle, PDS, and signing key.

    the miniDoc is bidirectionally verified by slingshot, so the handle is
    confirmed to resolve back to the DID. that verification says the DID owns
    the document, not that the document names a reasonable PDS: for `did:web`
    the document is served from the subject's own domain, so `serviceEndpoint`
    is whatever they say it is. the endpoint is `is_safe_url`-checked here,
    at the boundary where it enters, because everything downstream treats
    `Artist.pds_url` as a host we chose to trust.

    a miniDoc is accepted or rejected whole — a hostile PDS also blocks the
    handle update it arrived with, rather than half-trusting the document.

    args:
        did: the DID to resolve (also accepts a handle as the identifier).

    raises:
        httpx.HTTPError on transport/status failure; KeyError if the response
        is missing required fields; UnsafePdsEndpoint if the PDS is not a
        URL we will talk to.
    """
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        resp = await client.get(
            f"{SLINGSHOT_URL}/xrpc/com.bad-example.identity.resolveMiniDoc",
            params={"identifier": did},
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
        if not is_safe_url(pds := data["pds"]):
            raise UnsafePdsEndpoint(f"refusing PDS endpoint {pds!r} for {did}")
        return MiniDoc(
            did=data["did"],
            handle=data["handle"],
            pds=data["pds"],
            signing_key=data.get("signing_key", ""),
        )


async def resolve_mini_doc_safe(did: str) -> MiniDoc | None:
    """resolve a miniDoc, returning None instead of raising on any failure."""
    try:
        return await resolve_mini_doc(did)
    except Exception as e:
        logger.warning(f"slingshot miniDoc resolution failed for {did}: {e}")
        return None
