"""verified read-after-write for client-authored records.

a client that writes a record to its own PDS tells us the AT URI here, and we
index it immediately instead of waiting for jetstream. the claim is never
trusted: the record is fetched from the caller's own PDS and dispatched to the
same ingest functions the firehose path uses, so a forged or malformed URI
indexes nothing. jetstream remains the reconciler — this route only moves
"when", never "whether" (#1796 makes it also a durability backstop for our own
users' writes).
"""

import httpx
import logfire
from atproto_oauth.security import is_safe_url
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.tasks.ingest import (
    SubjectNotFoundError,
    ingest_like_create,
    ingest_like_delete,
)
from backend.config import settings
from backend.utilities.rate_limit import limiter

router = APIRouter(prefix="/ingest", tags=["ingest"])

_FETCH_TIMEOUT_SECONDS = 10.0


class IngestRecordRequest(BaseModel):
    uri: str = Field(min_length=1, max_length=1024)


class IngestRecordResponse(BaseModel):
    status: str


def _parse_own_record_uri(uri: str, did: str) -> tuple[str, str]:
    """(collection, rkey) of an at:// URI in the caller's own repo; 4xx otherwise."""
    prefix = "at://"
    if not uri.startswith(prefix):
        raise HTTPException(status_code=400, detail="not an at:// URI")
    parts = uri.removeprefix(prefix).split("/")
    if len(parts) != 3 or not all(parts):
        raise HTTPException(status_code=400, detail="malformed at:// URI")
    repo, collection, rkey = parts
    if repo != did:
        raise HTTPException(status_code=403, detail="record is not in your repo")
    return collection, rkey


def _supported_collections() -> set[str]:
    return {settings.atproto.like_collection}


@router.post("/record")
@limiter.limit(settings.rate_limit.default_limit)
async def ingest_record(
    request: Request,
    body: IngestRecordRequest,
    auth_session: AuthSession = Depends(require_auth),
) -> IngestRecordResponse:
    """index a record the caller just wrote to (or deleted from) their own PDS.

    the record's current state on the PDS decides what happens: present →
    create/update ingest; absent → delete ingest. either way the PDS is the
    source, so the response reflects reality even when the client lies.
    """
    collection, rkey = _parse_own_record_uri(body.uri, auth_session.did)
    if collection not in _supported_collections():
        raise HTTPException(
            status_code=404, detail=f"collection not indexed here: {collection}"
        )

    pds_url = (auth_session.oauth_session or {}).get("pds_url")
    if not pds_url or not is_safe_url(pds_url):
        raise HTTPException(status_code=502, detail="your PDS endpoint is not usable")

    async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT_SECONDS) as client:
        try:
            response = await client.get(
                f"{pds_url}/xrpc/com.atproto.repo.getRecord",
                params={
                    "repo": auth_session.did,
                    "collection": collection,
                    "rkey": rkey,
                },
            )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502, detail="could not reach your PDS"
            ) from e

    with logfire.span(
        "ingest echo",
        uri=body.uri,
        collection=collection,
        pds_status=response.status_code,
    ):
        if response.status_code == 200:
            payload = response.json()
            record = payload.get("value")
            if not isinstance(record, dict):
                raise HTTPException(
                    status_code=502, detail="PDS returned a malformed record"
                )
            try:
                await ingest_like_create(
                    auth_session.did,
                    rkey,
                    record,
                    body.uri,
                    cid=payload.get("cid"),
                )
            except SubjectNotFoundError as e:
                raise HTTPException(
                    status_code=404, detail="the record's subject is not indexed here"
                ) from e
            return IngestRecordResponse(status="indexed")

        if response.status_code in (400, 404):
            await ingest_like_delete(auth_session.did, rkey, body.uri)
            return IngestRecordResponse(status="deleted")

        raise HTTPException(
            status_code=502,
            detail=f"your PDS answered {response.status_code}",
        )
