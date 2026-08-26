"""attested.network payment attestation verification.

verifies portable payment attestations (spec: https://attested.network):
the payer holds a `network.attested.payment.{oneTime,recurring}` record in
their own PDS with `subject` = recipient DID, cross-signed by a broker proof
(`network.attested.payment.proof`, same rkey) in a trusted broker's repo.

verification checks the proof exists in a trusted broker's repo with
`status: "verified"` and that the payer record's signature strongRef matches
the proof record's actual CID. live proofs do not pin the payer record's
current content (observed 2026-08-26: 0/7 sampled proofs match), so mutable
payer-record fields are taken on the payer's word pending broker guidance.
"""

import logging

import httpx
import logfire

from backend._internal.slingshot import resolve_mini_doc_safe
from backend.config import settings

logger = logging.getLogger(__name__)

PROOF_COLLECTION = "network.attested.payment.proof"
PAYMENT_COLLECTIONS = (
    "network.attested.payment.oneTime",
    "network.attested.payment.recurring",
)
MAX_LIST_PAGES = 5


async def check_attested_support(
    supporter_did: str,
    artist_did: str,
    timeout: float = 5.0,
) -> bool:
    """check whether supporter_did holds a broker-verified payment attestation for artist_did."""
    with logfire.span(
        "attested.check_support",
        supporter_did=supporter_did,
        artist_did=artist_did,
    ):
        try:
            return await _check(supporter_did, artist_did, timeout)
        except httpx.TimeoutException:
            logfire.warn("attested verification timeout")
            return False
        except Exception as e:
            logfire.error("attested verification error", error=str(e), exc_info=True)
            return False


async def _check(supporter_did: str, artist_did: str, timeout: float) -> bool:
    doc = await resolve_mini_doc_safe(supporter_did)
    if doc is None:
        return False

    async with httpx.AsyncClient(timeout=timeout) as client:
        for record in await _payment_records(client, doc["pds"], supporter_did):
            if record.get("value", {}).get(
                "subject"
            ) == artist_did and await _proof_verifies(client, record):
                logfire.info(
                    "attested support verified",
                    record_uri=record.get("uri"),
                    supporter_did=supporter_did,
                    artist_did=artist_did,
                )
                return True
    return False


async def _payment_records(
    client: httpx.AsyncClient, pds: str, repo: str
) -> list[dict]:
    records: list[dict] = []
    for collection in PAYMENT_COLLECTIONS:
        cursor: str | None = None
        for _ in range(MAX_LIST_PAGES):
            params: dict[str, str | int] = {
                "repo": repo,
                "collection": collection,
                "limit": 100,
            }
            if cursor:
                params["cursor"] = cursor
            response = await client.get(
                f"{pds}/xrpc/com.atproto.repo.listRecords", params=params
            )
            if response.status_code != 200:
                break
            data = response.json()
            records.extend(data.get("records", []))
            if not (cursor := data.get("cursor")):
                break
    return records


async def _proof_verifies(client: httpx.AsyncClient, record: dict) -> bool:
    rkey = record.get("uri", "").rsplit("/", 1)[-1]
    for signature in record.get("value", {}).get("signatures", []):
        uri = signature.get("uri", "")
        if not uri.startswith("at://"):
            continue
        parts = uri.removeprefix("at://").split("/")
        if len(parts) != 3:
            continue
        broker_did, collection, proof_rkey = parts
        if (
            broker_did not in settings.atproto.trusted_payment_brokers
            or collection != PROOF_COLLECTION
            or proof_rkey != rkey
        ):
            continue
        broker_doc = await resolve_mini_doc_safe(broker_did)
        if broker_doc is None:
            continue
        response = await client.get(
            f"{broker_doc['pds']}/xrpc/com.atproto.repo.getRecord",
            params={"repo": broker_did, "collection": collection, "rkey": proof_rkey},
        )
        if response.status_code != 200:
            continue
        proof = response.json()
        if (
            proof.get("cid") == signature.get("cid")
            and proof.get("value", {}).get("status") == "verified"
        ):
            return True
    return False
