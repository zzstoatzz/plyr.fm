"""share link tracking endpoints for listen receipts."""

import secrets
from typing import Annotated

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session, require_auth
from backend.config import settings
from backend.models import Artist, ShareLink, ShareLinkEvent, Track, get_db
from backend.schemas import TrackResponse

from .router import router


class ShareLinkResponse(BaseModel):
    """response for creating a share link."""

    code: str
    url: str


class ListenerStats(BaseModel):
    """stats for a listener on a share link."""

    did: str
    handle: str
    display_name: str | None
    avatar_url: str | None
    play_count: int


class ShareLinkStats(BaseModel):
    """stats for a single share link."""

    code: str
    track: TrackResponse
    click_count: int
    play_count: int
    anonymous_plays: int
    listeners: list[ListenerStats]
    created_at: str


class ShareListResponse(BaseModel):
    """paginated list of share links with stats."""

    shares: list[ShareLinkStats]
    total: int
    has_more: bool


def generate_share_code() -> str:
    """generate a unique 8-character share code."""
    return secrets.token_urlsafe(6)  # yields 8 chars


@router.post("/{track_id}/share")
async def create_share_link(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> ShareLinkResponse:
    """create a trackable share link for a track.

    generates a unique code that can be appended as ?ref={code} to track URLs.
    each call creates a new share link (one per share action).
    """
    # verify track exists
    track = await db.scalar(select(Track).where(Track.id == track_id))
    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # generate unique code with collision retry
    for _ in range(5):
        code = generate_share_code()
        existing = await db.scalar(select(ShareLink).where(ShareLink.code == code))
        if not existing:
            break
    else:
        raise HTTPException(status_code=500, detail="failed to generate unique code")

    # create share link
    share_link = ShareLink(
        code=code,
        track_id=track_id,
        creator_did=auth_session.did,
    )
    db.add(share_link)
    await db.commit()

    # build URL
    frontend_url = settings.frontend.url or "https://plyr.fm"
    url = f"{frontend_url}/track/{track_id}?ref={code}"

    return ShareLinkResponse(code=code, url=url)


@router.post("/{track_id}/ref/{code}/click")
async def record_share_click(
    track_id: int,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: AuthSession | None = Depends(get_optional_session),
) -> dict:
    """record a click event when someone visits a track via a share link.

    called by frontend when page loads with ?ref= parameter.
    skips recording if the visitor is the share link creator (self-click).
    """
    # find the share link
    share_link = await db.scalar(
        select(ShareLink).where(ShareLink.code == code, ShareLink.track_id == track_id)
    )
    if not share_link:
        # silently ignore invalid codes - don't leak info about valid codes
        return {"ok": True}

    # skip self-clicks
    visitor_did = session.did if session else None
    if visitor_did and visitor_did == share_link.creator_did:
        return {"ok": True}

    # record click event
    event = ShareLinkEvent(
        share_link_id=share_link.id,
        visitor_did=visitor_did,
        event_type="click",
    )
    db.add(event)
    await db.commit()

    return {"ok": True}


@router.get("/me/shares")
async def list_my_shares(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> ShareListResponse:
    """list share links created by the authenticated user with aggregated stats.

    returns paginated list of share links with click/play counts and listener breakdown.
    """
    # count total shares
    total = await db.scalar(
        select(func.count(ShareLink.id)).where(
            ShareLink.creator_did == auth_session.did
        )
    )
    total = total or 0

    # fetch share links with tracks
    stmt = (
        select(ShareLink)
        .options(selectinload(ShareLink.track).selectinload(Track.artist))
        .options(selectinload(ShareLink.track).selectinload(Track.album_rel))
        .where(ShareLink.creator_did == auth_session.did)
        .order_by(ShareLink.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    share_links = result.scalars().all()

    shares = []
    for share_link in share_links:
        # get event counts
        click_count = await db.scalar(
            select(func.count(ShareLinkEvent.id)).where(
                ShareLinkEvent.share_link_id == share_link.id,
                ShareLinkEvent.event_type == "click",
            )
        )
        play_count = await db.scalar(
            select(func.count(ShareLinkEvent.id)).where(
                ShareLinkEvent.share_link_id == share_link.id,
                ShareLinkEvent.event_type == "play",
            )
        )
        anonymous_plays = await db.scalar(
            select(func.count(ShareLinkEvent.id)).where(
                ShareLinkEvent.share_link_id == share_link.id,
                ShareLinkEvent.event_type == "play",
                ShareLinkEvent.visitor_did.is_(None),
            )
        )

        # get listener breakdown (authenticated plays only)
        listener_stmt = (
            select(
                ShareLinkEvent.visitor_did,
                func.count(ShareLinkEvent.id).label("play_count"),
            )
            .where(
                ShareLinkEvent.share_link_id == share_link.id,
                ShareLinkEvent.event_type == "play",
                ShareLinkEvent.visitor_did.isnot(None),
            )
            .group_by(ShareLinkEvent.visitor_did)
            .order_by(func.count(ShareLinkEvent.id).desc())
        )
        listener_result = await db.execute(listener_stmt)
        listener_rows = listener_result.all()

        # enrich with artist info
        listeners = []
        for visitor_did, visitor_play_count in listener_rows:
            artist = await db.scalar(select(Artist).where(Artist.did == visitor_did))
            if artist:
                listeners.append(
                    ListenerStats(
                        did=visitor_did,
                        handle=artist.handle,
                        display_name=artist.display_name,
                        avatar_url=artist.avatar_url,
                        play_count=visitor_play_count,
                    )
                )
            else:
                # fallback for users without artist profile
                listeners.append(
                    ListenerStats(
                        did=visitor_did,
                        handle=visitor_did,
                        display_name=None,
                        avatar_url=None,
                        play_count=visitor_play_count,
                    )
                )

        # build track response
        track_response = await TrackResponse.from_track(share_link.track)

        shares.append(
            ShareLinkStats(
                code=share_link.code,
                track=track_response,
                click_count=click_count or 0,
                play_count=play_count or 0,
                anonymous_plays=anonymous_plays or 0,
                listeners=listeners,
                created_at=share_link.created_at.isoformat(),
            )
        )

    return ShareListResponse(
        shares=shares,
        total=total,
        has_more=offset + len(shares) < total,
    )
