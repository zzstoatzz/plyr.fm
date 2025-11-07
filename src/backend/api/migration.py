"""API endpoints for namespace migration."""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend._internal import Session as AuthSession
from backend._internal import oauth_client, require_auth
from backend.atproto.records import _reconstruct_oauth_session, _refresh_session_tokens
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/migration", tags=["migration"])


@router.get("/check")
async def check_migration_needed(
    session: AuthSession = Depends(require_auth),
) -> dict[str, Any]:
    """check if user has records in old namespace that need migration.

    returns:
        {
            "needs_migration": bool,
            "old_record_count": int,
            "old_collection": str | None
        }
    """
    logger.debug(f"migration check requested for {session.did}")

    # only check if old namespace is configured
    if not settings.atproto.old_app_namespace:
        logger.debug("no old namespace configured, skipping migration check")
        return {
            "needs_migration": False,
            "old_record_count": 0,
            "old_collection": None,
            "new_collection": settings.atproto.track_collection,
            "did": session.did,
        }

    old_collection = settings.atproto.old_track_collection
    if not old_collection:
        logger.debug("no old collection configured, skipping migration check")
        return {
            "needs_migration": False,
            "old_record_count": 0,
            "old_collection": None,
            "new_collection": settings.atproto.track_collection,
            "did": session.did,
        }

    logger.debug(f"checking for records in old collection: {old_collection}")

    try:
        # reconstruct OAuth session
        oauth_data = session.oauth_session
        if not oauth_data or "access_token" not in oauth_data:
            raise HTTPException(status_code=401, detail="invalid session")

        oauth_session = _reconstruct_oauth_session(oauth_data)

        # list records from old collection
        url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.listRecords"
        params = {
            "repo": session.did,
            "collection": old_collection,
            "limit": 100,  # max we can get in one request
        }

        # try request, refresh token if expired
        for attempt in range(2):
            response = await oauth_client.make_authenticated_request(
                session=oauth_session,
                method="GET",
                url=url,
                params=params,
            )

            if response.status_code == 200:
                result = response.json()
                records = result.get("records", [])
                logger.debug(
                    f"found {len(records)} records in {old_collection} for {session.did}"
                )
                return {
                    "needs_migration": len(records) > 0,
                    "old_record_count": len(records),
                    "old_collection": old_collection,
                    "new_collection": settings.atproto.track_collection,
                    "did": session.did,
                }

            # token expired - refresh and retry
            if response.status_code == 401 and attempt == 0:
                try:
                    error_data = response.json()
                    if "exp" in error_data.get("message", ""):
                        logger.info(
                            f"access token expired for {session.did}, refreshing"
                        )
                        oauth_session = await _refresh_session_tokens(
                            session, oauth_session
                        )
                        continue
                except Exception:
                    pass

            # error
            logger.error(
                f"failed to list old records for {session.did}: {response.status_code} {response.text}"
            )
            raise HTTPException(
                status_code=response.status_code,
                detail=f"failed to check old records: {response.text}",
            )

        raise HTTPException(status_code=500, detail="failed to check migration status")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"error checking migration for {session.did}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/migrate")
async def migrate_records(
    session: AuthSession = Depends(require_auth),
) -> dict[str, Any]:
    """migrate user's records from old namespace to new namespace.

    this will:
    1. list all records from old collection
    2. create copies in new collection
    3. delete old records after successful migration

    returns:
        {
            "migrated_count": int,
            "deleted_count": int,
            "failed_count": int,
            "errors": list[str]
        }
    """
    # only migrate if old namespace is configured
    if not settings.atproto.old_app_namespace:
        raise HTTPException(status_code=400, detail="migration not available")

    old_collection = settings.atproto.old_track_collection
    if not old_collection:
        raise HTTPException(status_code=400, detail="migration not available")

    try:
        # reconstruct OAuth session
        oauth_data = session.oauth_session
        if not oauth_data or "access_token" not in oauth_data:
            raise HTTPException(status_code=401, detail="invalid session")

        oauth_session = _reconstruct_oauth_session(oauth_data)

        # list all records from old collection
        url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.listRecords"
        params = {
            "repo": session.did,
            "collection": old_collection,
            "limit": 100,
        }

        # fetch old records (with token refresh if needed)
        for attempt in range(2):
            response = await oauth_client.make_authenticated_request(
                session=oauth_session,
                method="GET",
                url=url,
                params=params,
            )

            if response.status_code == 200:
                break

            if response.status_code == 401 and attempt == 0:
                try:
                    error_data = response.json()
                    if "exp" in error_data.get("message", ""):
                        oauth_session = await _refresh_session_tokens(
                            session, oauth_session
                        )
                        continue
                except Exception:
                    pass

            raise HTTPException(
                status_code=response.status_code,
                detail=f"failed to list old records: {response.text}",
            )

        result = response.json()
        old_records = result.get("records", [])

        if not old_records:
            return {
                "migrated_count": 0,
                "failed_count": 0,
                "errors": [],
            }

        # migrate each record to new collection concurrently
        create_url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.createRecord"
        delete_url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.deleteRecord"

        async def migrate_single_record(old_record: dict[str, Any]) -> dict[str, Any]:
            """migrate a single record and return result."""
            nonlocal oauth_session
            result = {"migrated": False, "deleted": False, "error": None}
            try:
                # extract record value
                record_value = old_record.get("value", {})

                # handle both dict and DotDict objects
                if hasattr(record_value, "to_dict"):
                    record_value = record_value.to_dict()

                # create record in new collection
                payload = {
                    "repo": session.did,
                    "collection": settings.atproto.track_collection,
                    "record": {
                        "$type": settings.atproto.track_collection,
                        "title": record_value.get("title", ""),
                        "artist": record_value.get("artist", ""),
                        "audioUrl": record_value.get("audioUrl", ""),
                        "fileType": record_value.get("fileType", ""),
                        "createdAt": record_value.get("createdAt", ""),
                        **(
                            {("album"): record_value["album"]}
                            if "album" in record_value
                            else {}
                        ),
                        **(
                            {("duration"): record_value["duration"]}
                            if "duration" in record_value
                            else {}
                        ),
                        **(
                            {("features"): record_value["features"]}
                            if "features" in record_value
                            else {}
                        ),
                    },
                }

                # try creating the record, refresh token if expired
                for create_attempt in range(2):
                    create_response = await oauth_client.make_authenticated_request(
                        session=oauth_session,
                        method="POST",
                        url=create_url,
                        json=payload,
                    )

                    if create_response.status_code in (200, 201):
                        result["migrated"] = True
                        logger.info(
                            f"migrated record {old_record.get('uri')} for {session.did}"
                        )

                        # delete old record after successful migration
                        old_uri = old_record.get("uri", "")
                        if old_uri:
                            # extract rkey from uri
                            rkey = old_uri.split("/")[-1]
                            delete_payload = {
                                "repo": session.did,
                                "collection": old_collection,
                                "rkey": rkey,
                            }

                            # try deleting with token refresh
                            for delete_attempt in range(2):
                                delete_response = (
                                    await oauth_client.make_authenticated_request(
                                        session=oauth_session,
                                        method="POST",
                                        url=delete_url,
                                        json=delete_payload,
                                    )
                                )

                                if delete_response.status_code in (200, 201):
                                    result["deleted"] = True
                                    logger.info(
                                        f"deleted old record {old_uri} for {session.did}"
                                    )
                                    break

                                # token expired - refresh and retry
                                if (
                                    delete_response.status_code == 401
                                    and delete_attempt == 0
                                ):
                                    try:
                                        error_data = delete_response.json()
                                        if "exp" in error_data.get("message", ""):
                                            oauth_session = (
                                                await _refresh_session_tokens(
                                                    session, oauth_session
                                                )
                                            )
                                            continue
                                    except Exception:
                                        pass

                                # deletion failed, log but don't fail migration
                                logger.warning(
                                    f"failed to delete old record {old_uri}: {delete_response.status_code}"
                                )
                                break

                        return result

                    # token expired - refresh and retry
                    if create_response.status_code == 401 and create_attempt == 0:
                        try:
                            error_data = create_response.json()
                            if "exp" in error_data.get("message", ""):
                                logger.info(
                                    f"access token expired during migration for {session.did}, refreshing"
                                )
                                oauth_session = await _refresh_session_tokens(
                                    session, oauth_session
                                )
                                continue
                        except Exception:
                            pass

                    # other error or retry failed
                    result["error"] = (
                        f"failed to create record: {create_response.status_code} {create_response.text}"
                    )
                    logger.error(result["error"])
                    return result

            except Exception as e:
                result["error"] = f"error migrating record {old_record.get('uri')}: {e}"
                logger.error(result["error"], exc_info=True)

            return result

        # run all migrations concurrently
        results = await asyncio.gather(
            *[migrate_single_record(record) for record in old_records],
            return_exceptions=True,
        )

        # aggregate results
        migrated_count = sum(
            1 for r in results if isinstance(r, dict) and r.get("migrated")
        )
        deleted_count = sum(
            1 for r in results if isinstance(r, dict) and r.get("deleted")
        )
        failed_count = sum(1 for r in results if isinstance(r, dict) and r.get("error"))
        errors = [r["error"] for r in results if isinstance(r, dict) and r.get("error")]

        return {
            "migrated_count": migrated_count,
            "deleted_count": deleted_count,
            "failed_count": failed_count,
            "errors": errors,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"error during migration for {session.did}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) from e
