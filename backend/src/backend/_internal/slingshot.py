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

logger = logging.getLogger(__name__)

SLINGSHOT_URL = "https://slingshot.microcosm.blue"
USER_AGENT = "plyr.fm (zzstoatzz.io)"


class MiniDoc(TypedDict):
    """verified identity summary returned by resolveMiniDoc."""

    did: str
    handle: str
    pds: str
    signing_key: str


async def resolve_mini_doc(did: str) -> MiniDoc:
    """resolve a DID to its current verified handle, PDS, and signing key.

    the miniDoc is bidirectionally verified by slingshot, so the handle is
    confirmed to resolve back to the DID.

    args:
        did: the DID to resolve (also accepts a handle as the identifier).

    raises:
        httpx.HTTPError on transport/status failure; KeyError if the response
        is missing required fields.
    """
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        resp = await client.get(
            f"{SLINGSHOT_URL}/xrpc/com.bad-example.identity.resolveMiniDoc",
            params={"identifier": did},
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
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
