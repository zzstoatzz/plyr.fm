"""atprotofans integration for supporter validation.

atprotofans is a creator support platform on ATProto. this module provides
server-side validation of supporter relationships for content gating.

the validation uses the three-party model:
- supporter: has com.atprotofans.supporter record in their PDS
- creator: has com.atprotofans.supporterProof record in their PDS
- broker: has com.atprotofans.brokerProof record (atprotofans service)

for direct atprotofans contributions (not via platform registration),
the signer is the artist's own DID.

see: https://atprotofans.leaflet.pub/3mabsmts3rs2b
"""

import asyncio

import httpx
import logfire
from pydantic import BaseModel


class SupporterValidation(BaseModel):
    """result of validating supporter status."""

    valid: bool
    profile: dict | None = None


async def validate_supporter(
    supporter_did: str,
    artist_did: str,
    timeout: float = 5.0,
) -> SupporterValidation:
    """validate if a user supports an artist via atprotofans.

    for direct atprotofans contributions, the signer is the artist's DID.

    args:
        supporter_did: DID of the potential supporter
        artist_did: DID of the artist (also used as signer)
        timeout: request timeout in seconds

    returns:
        SupporterValidation with valid=True if supporter, valid=False otherwise
    """
    url = "https://atprotofans.com/xrpc/com.atprotofans.validateSupporter"
    params = {
        "supporter": supporter_did,
        "subject": artist_did,
        "signer": artist_did,  # for direct contributions, signer = artist
    }

    with logfire.span(
        "atprotofans.validate_supporter",
        supporter_did=supporter_did,
        artist_did=artist_did,
    ):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(url, params=params)

                if response.status_code != 200:
                    logfire.warn(
                        "atprotofans validation failed",
                        status_code=response.status_code,
                        response_text=response.text[:200],
                    )
                    return SupporterValidation(valid=False)

                data = response.json()
                is_valid = data.get("valid", False)

                logfire.info(
                    "atprotofans validation result",
                    valid=is_valid,
                    has_profile=data.get("profile") is not None,
                )

                return SupporterValidation(
                    valid=is_valid,
                    profile=data.get("profile"),
                )

        except httpx.TimeoutException:
            logfire.warn("atprotofans validation timeout")
            return SupporterValidation(valid=False)
        except Exception as e:
            logfire.error(
                "atprotofans validation error",
                error=str(e),
                exc_info=True,
            )
            return SupporterValidation(valid=False)


async def get_supported_artists(
    supporter_did: str,
    artist_dids: set[str],
    timeout: float = 5.0,
) -> set[str]:
    """batch check which artists a user supports.

    args:
        supporter_did: DID of the potential supporter
        artist_dids: set of artist DIDs to check
        timeout: request timeout per check

    returns:
        set of artist DIDs the user supports
    """
    if not artist_dids:
        return set()

    async def check_one(artist_did: str) -> str | None:
        result = await validate_supporter(supporter_did, artist_did, timeout)
        return artist_did if result.valid else None

    results = await asyncio.gather(*[check_one(did) for did in artist_dids])
    return {did for did in results if did is not None}
