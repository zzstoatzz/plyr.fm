"""API endpoints for namespace migration."""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto.records import (
    _make_pds_query,
    _make_pds_request,
)
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
        result = await _make_pds_query(
            session,
            "com.atproto.repo.listRecords",
            {
                "repo": session.did,
                "collection": old_collection,
                "limit": 100,
            },
        )
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
        # list all records from old collection
        list_result = await _make_pds_query(
            session,
            "com.atproto.repo.listRecords",
            {
                "repo": session.did,
                "collection": old_collection,
                "limit": 100,
            },
        )

        if not (old_records := list_result.get("records", [])):
            return {
                "migrated_count": 0,
                "deleted_count": 0,
                "failed_count": 0,
                "errors": [],
            }

        async def migrate_single_record(old_record: dict[str, Any]) -> dict[str, Any]:
            """migrate a single record and return result."""
            result = {"migrated": False, "deleted": False, "error": None}
            try:
                # extract record value
                record_value = old_record.get("value", {})

                # handle both dict and DotDict objects
                if hasattr(record_value, "to_dict"):
                    record_value = record_value.to_dict()

                # create record in new collection
                create_payload = {
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
                            {"album": record_value["album"]}
                            if "album" in record_value
                            else {}
                        ),
                        **(
                            {"duration": record_value["duration"]}
                            if "duration" in record_value
                            else {}
                        ),
                        **(
                            {"features": record_value["features"]}
                            if "features" in record_value
                            else {}
                        ),
                    },
                }

                await _make_pds_request(
                    session,
                    "POST",
                    "com.atproto.repo.createRecord",
                    create_payload,
                )
                result["migrated"] = True
                logger.info(
                    f"migrated record {old_record.get('uri')} for {session.did}"
                )

                # delete old record after successful migration
                old_uri = old_record.get("uri", "")
                if old_uri:
                    rkey = old_uri.split("/")[-1]
                    delete_payload = {
                        "repo": session.did,
                        "collection": old_collection,
                        "rkey": rkey,
                    }

                    try:
                        await _make_pds_request(
                            session,
                            "POST",
                            "com.atproto.repo.deleteRecord",
                            delete_payload,
                        )
                        result["deleted"] = True
                        logger.info(f"deleted old record {old_uri} for {session.did}")
                    except Exception as delete_err:
                        logger.warning(
                            f"failed to delete old record {old_uri}: {delete_err}"
                        )

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
