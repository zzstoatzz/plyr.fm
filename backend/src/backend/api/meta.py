"""meta endpoints — health, config, OAuth metadata, robots, sitemap."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.auth import get_public_jwks, is_confidential_client
from backend.config import settings
from backend.models import Album, Artist, Track, get_db

router = APIRouter(tags=["meta"])


@router.get("/health")
async def health() -> dict[str, str]:
    """health check endpoint."""
    return {"status": "ok"}


@router.get("/config")
async def get_public_config() -> dict[str, int | str | list[str]]:
    """expose public configuration to frontend."""
    from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

    return {
        "max_upload_size_mb": settings.storage.max_upload_size_mb,
        "max_image_size_mb": 20,  # hardcoded limit for cover art
        "default_hidden_tags": DEFAULT_HIDDEN_TAGS,
        "bufo_exclude_patterns": list(settings.bufo.exclude_patterns),
        "bufo_include_patterns": list(settings.bufo.include_patterns),
        "contact_email": settings.legal.contact_email,
        "privacy_email": settings.legal.resolved_privacy_email,
        "dmca_email": settings.legal.resolved_dmca_email,
        "dmca_registration_number": settings.legal.dmca_registration_number,
        "terms_last_updated": settings.legal.terms_last_updated.isoformat(),
    }


@router.get("/oauth-client-metadata.json")
async def client_metadata() -> dict[str, Any]:
    """serve OAuth client metadata.

    returns metadata for public or confidential client depending on
    whether OAUTH_JWK is configured.
    """
    # extract base URL from client_id for client_uri
    client_uri = settings.atproto.client_id.replace("/oauth-client-metadata.json", "")

    metadata: dict[str, Any] = {
        "client_id": settings.atproto.client_id,
        "client_name": settings.app.name,
        "client_uri": client_uri,
        "redirect_uris": [settings.atproto.redirect_uri],
        "scope": settings.atproto.resolved_scope_with_teal(
            settings.teal.play_collection, settings.teal.status_collection
        ),
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "application_type": "web",
        "dpop_bound_access_tokens": True,
    }

    if is_confidential_client():
        # confidential client: use private_key_jwt authentication
        # this gives us 180-day refresh tokens instead of 2-week
        metadata["token_endpoint_auth_method"] = "private_key_jwt"
        metadata["token_endpoint_auth_signing_alg"] = "ES256"
        metadata["jwks_uri"] = f"{client_uri}/.well-known/jwks.json"
    else:
        # public client: no authentication
        metadata["token_endpoint_auth_method"] = "none"

    return metadata


@router.get("/.well-known/jwks.json")
async def jwks_endpoint() -> dict[str, Any]:
    """serve public JWKS for confidential client authentication.

    returns 404 if confidential client is not configured.
    """
    jwks = get_public_jwks()
    if jwks is None:
        raise HTTPException(
            status_code=404,
            detail="JWKS not available - confidential client not configured",
        )

    return jwks


@router.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    """serve robots.txt to tell crawlers this is an API, not a website."""
    return PlainTextResponse(
        "User-agent: *\nDisallow: /\n",
        media_type="text/plain",
    )


@router.get("/sitemap-data")
async def sitemap_data(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """return minimal data needed to generate sitemap.xml.

    returns tracks, artists, and albums with just IDs/slugs and timestamps.
    the frontend renders this into XML at /sitemap.xml.
    """
    # fetch all tracks (id, created_at)
    tracks_result = await db.execute(
        select(Track.id, Track.created_at).order_by(Track.created_at.desc())
    )
    tracks = [
        {"id": row.id, "updated": row.created_at.strftime("%Y-%m-%d")}
        for row in tracks_result.all()
    ]

    # fetch all artists with at least one track (handle, updated_at)
    artists_result = await db.execute(
        select(Artist.handle, Artist.updated_at)
        .join(Track, Artist.did == Track.artist_did)
        .distinct()
        .order_by(Artist.updated_at.desc())
    )
    artists = [
        {"handle": row.handle, "updated": row.updated_at.strftime("%Y-%m-%d")}
        for row in artists_result.all()
    ]

    # fetch all albums (artist handle, slug, updated_at)
    albums_result = await db.execute(
        select(Album.slug, Artist.handle, Album.updated_at)
        .join(Artist, Album.artist_did == Artist.did)
        .order_by(Album.updated_at.desc())
    )
    albums = [
        {
            "handle": row.handle,
            "slug": row.slug,
            "updated": row.updated_at.strftime("%Y-%m-%d"),
        }
        for row in albums_result.all()
    ]

    return {"tracks": tracks, "artists": artists, "albums": albums}
