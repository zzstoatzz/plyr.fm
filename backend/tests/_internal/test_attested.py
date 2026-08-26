"""tests for attested.network payment attestation verification.

fixtures mirror the live record shapes observed 2026-08-26: a payer record
in the supporter's repo whose signatures strongRef points at a proof record
(same rkey) in the broker's repo, verified by matching the proof record's
actual CID against the strongRef and checking status "verified".
"""

from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend._internal.attested import check_attested_support
from backend._internal.slingshot import MiniDoc

SUPPORTER_DID = "did:plc:supporter123"
ARTIST_DID = "did:plc:artist456"
BROKER_DID = "did:plc:7srqsetux75b6flzbbyag2ro"
SUPPORTER_PDS = "https://pds.supporter.example"
BROKER_PDS = "https://pds.broker.example"
RKEY = "byufwlvuo4u7c"
PROOF_URI = f"at://{BROKER_DID}/network.attested.payment.proof/{RKEY}"
PROOF_RECORD_CID = "bafyreiproofrecordcid"


def _payer_record(
    subject: str = ARTIST_DID, signature_cid: str = PROOF_RECORD_CID
) -> dict[str, Any]:
    return {
        "uri": f"at://{SUPPORTER_DID}/network.attested.payment.oneTime/{RKEY}",
        "cid": "bafyreipayerrecordcid",
        "value": {
            "$type": "network.attested.payment.oneTime",
            "txnid": RKEY,
            "subject": subject,
            "amount": 2500,
            "currency": "USD",
            "signatures": [
                {
                    "$type": "com.atproto.repo.strongRef",
                    "uri": PROOF_URI,
                    "cid": signature_cid,
                }
            ],
        },
    }


def _proof_response(status: str = "verified") -> dict[str, Any]:
    return {
        "uri": PROOF_URI,
        "cid": PROOF_RECORD_CID,
        "value": {"$type": "network.attested.payment.proof", "status": status},
    }


def _mini_doc(did: str, pds: str) -> MiniDoc:
    return MiniDoc(did=did, handle="someone.example", pds=pds, signing_key="")


def _client_for(
    payer_records: list[dict[str, Any]], proof: dict[str, Any] | None
) -> AsyncMock:
    def respond(url: str, params: dict[str, Any] | None = None) -> MagicMock:
        response = MagicMock()
        params = params or {}
        if "listRecords" in url:
            records = (
                payer_records
                if params.get("collection") == "network.attested.payment.oneTime"
                else []
            )
            response.status_code = 200
            response.json.return_value = {"records": records}
        elif "getRecord" in url and proof is not None:
            response.status_code = 200
            response.json.return_value = proof
        else:
            response.status_code = 404
            response.json.return_value = {}
        return response

    client = AsyncMock(spec=httpx.AsyncClient)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.get = AsyncMock(side_effect=respond)
    return client


@pytest.fixture
def _resolver() -> Iterator[AsyncMock]:
    docs = {
        SUPPORTER_DID: _mini_doc(SUPPORTER_DID, SUPPORTER_PDS),
        BROKER_DID: _mini_doc(BROKER_DID, BROKER_PDS),
    }
    resolver = AsyncMock(side_effect=lambda did: docs.get(did))
    with patch("backend._internal.attested.resolve_mini_doc_safe", resolver):
        yield resolver


async def test_verified_attestation_validates(_resolver: AsyncMock) -> None:
    client = _client_for([_payer_record()], _proof_response())
    with patch("backend._internal.attested.httpx.AsyncClient", return_value=client):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is True


async def test_wrong_subject_does_not_validate(_resolver: AsyncMock) -> None:
    client = _client_for(
        [_payer_record(subject="did:plc:someoneelse")], _proof_response()
    )
    with patch("backend._internal.attested.httpx.AsyncClient", return_value=client):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is False


async def test_proof_cid_mismatch_does_not_validate(_resolver: AsyncMock) -> None:
    """a signature strongRef that doesn't match the proof record's CID is rejected."""
    client = _client_for(
        [_payer_record(signature_cid="bafyreisomethingelse")], _proof_response()
    )
    with patch("backend._internal.attested.httpx.AsyncClient", return_value=client):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is False


async def test_unverified_proof_status_does_not_validate(_resolver: AsyncMock) -> None:
    client = _client_for([_payer_record()], _proof_response(status="pending"))
    with patch("backend._internal.attested.httpx.AsyncClient", return_value=client):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is False


async def test_untrusted_broker_does_not_validate(_resolver: AsyncMock) -> None:
    """a proof from a broker outside the allowlist is never fetched or trusted."""
    record = _payer_record()
    record["value"]["signatures"][0]["uri"] = (
        f"at://did:plc:evilbroker/network.attested.payment.proof/{RKEY}"
    )
    client = _client_for([record], _proof_response())
    with patch("backend._internal.attested.httpx.AsyncClient", return_value=client):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is False
    assert all("getRecord" not in call.args[0] for call in client.get.call_args_list)


async def test_proof_rkey_must_match_record_rkey(_resolver: AsyncMock) -> None:
    """a signature pointing at a proof for a different transaction is rejected."""
    record = _payer_record()
    record["value"]["signatures"][0]["uri"] = (
        f"at://{BROKER_DID}/network.attested.payment.proof/otherrkey"
    )
    client = _client_for([record], _proof_response())
    with patch("backend._internal.attested.httpx.AsyncClient", return_value=client):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is False


async def test_unresolvable_supporter_pds_is_false() -> None:
    with patch(
        "backend._internal.attested.resolve_mini_doc_safe",
        AsyncMock(return_value=None),
    ):
        assert await check_attested_support(SUPPORTER_DID, ARTIST_DID) is False
