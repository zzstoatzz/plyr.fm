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

import logging

import httpx
import logfire
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SupporterValidation(BaseModel):
    """result of validating supporter status."""

    valid: bool
    profile: dict | None = None


async def check_atprotofans_support(
    supporter_did: str,
    artist_did: str,
    timeout: float = 5.0,
) -> SupporterValidation | None:
    """validate supporter status via the atprotofans validateSupporter endpoint.

    for direct atprotofans contributions, the signer is the artist's DID.
    returns None on transient failures (timeout, transport error) so the
    caller knows not to cache the answer.
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
            return None
        except Exception as e:
            logfire.error(
                "atprotofans validation error",
                error=str(e),
                exc_info=True,
            )
            return None
