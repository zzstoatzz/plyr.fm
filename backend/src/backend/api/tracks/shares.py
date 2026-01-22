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
from backend.schemas import OkResponse, TrackResponse

from .router import router


class ShareLinkResponse(BaseModel):
    """response for creating a share link."""

    code: str
    url: str


class UserStats(BaseModel):
    """stats for a user who interacted with a share link."""

    did: str
    handle: str
    display_name: str | None
    avatar_url: str | None
    count: int  # click_count or play_count depending on context


class ShareLinkStats(BaseModel):
    """stats for a single share link."""

    code: str
    track: TrackResponse
    click_count: int
    play_count: int
    anonymous_clicks: int
    anonymous_plays: int
    visitors: list[UserStats]  # authenticated users who clicked
    listeners: list[UserStats]  # authenticated users who played
    created_at: str


class ShareListResponse(BaseModel):
    """paginated list of share links with stats."""

    shares: list[ShareLinkStats]
    total: int
    has_more: bool


async def generate_unique_share_code(db: AsyncSession, max_attempts: int = 5) -> str:
    """generate a unique 8-character share code, retrying on collision.

    uses secrets.token_urlsafe(6) which yields 8 chars with 48 bits of entropy.
    at current scale, collision probability is negligible (<0.2% at 1M codes).
    """
    for _ in range(max_attempts):
        code = secrets.token_urlsafe(6)
        existing = await db.scalar(select(ShareLink).where(ShareLink.code == code))
        if not existing:
            return code
    raise HTTPException(status_code=500, detail="failed to generate unique code")


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

    code = await generate_unique_share_code(db)

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
) -> OkResponse:
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
        return OkResponse()

    # skip self-clicks
    visitor_did = session.did if session else None
    if visitor_did and visitor_did == share_link.creator_did:
        return OkResponse()

    # record click event
    event = ShareLinkEvent(
        share_link_id=share_link.id,
        visitor_did=visitor_did,
        event_type="click",
    )
    db.add(event)
    await db.commit()

    return OkResponse()


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

    async def get_user_stats(
        event_type: str, share_link_id: int
    ) -> tuple[list[UserStats], int]:
        """get authenticated user stats and anonymous count for an event type."""
        # get anonymous count
        anonymous_count = await db.scalar(
            select(func.count(ShareLinkEvent.id)).where(
                ShareLinkEvent.share_link_id == share_link_id,
                ShareLinkEvent.event_type == event_type,
                ShareLinkEvent.visitor_did.is_(None),
            )
        )

        # get authenticated user breakdown with artist info in single query
        user_stmt = (
            select(
                ShareLinkEvent.visitor_did,
                func.count(ShareLinkEvent.id).label("event_count"),
                Artist.handle,
                Artist.display_name,
                Artist.avatar_url,
            )
            .outerjoin(Artist, Artist.did == ShareLinkEvent.visitor_did)
            .where(
                ShareLinkEvent.share_link_id == share_link_id,
                ShareLinkEvent.event_type == event_type,
                ShareLinkEvent.visitor_did.isnot(None),
            )
            .group_by(
                ShareLinkEvent.visitor_did,
                Artist.handle,
                Artist.display_name,
                Artist.avatar_url,
            )
            .order_by(func.count(ShareLinkEvent.id).desc())
        )
        user_result = await db.execute(user_stmt)
        user_rows = user_result.all()

        users = [
            UserStats(
                did=visitor_did,
                handle=handle or visitor_did,
                display_name=display_name,
                avatar_url=avatar_url,
                count=event_count,
            )
            for visitor_did, event_count, handle, display_name, avatar_url in user_rows
        ]

        return users, anonymous_count or 0

    shares = []
    for share_link in share_links:
        # get visitor stats (clicks)
        visitors, anonymous_clicks = await get_user_stats("click", share_link.id)

        # get listener stats (plays)
        listeners, anonymous_plays = await get_user_stats("play", share_link.id)

        # total counts
        click_count = len(visitors) + anonymous_clicks
        play_count = len(listeners) + anonymous_plays

        # build track response
        track_response = await TrackResponse.from_track(share_link.track)

        shares.append(
            ShareLinkStats(
                code=share_link.code,
                track=track_response,
                click_count=click_count,
                play_count=play_count,
                anonymous_clicks=anonymous_clicks,
                anonymous_plays=anonymous_plays,
                visitors=visitors,
                listeners=listeners,
                created_at=share_link.created_at.isoformat(),
            )
        )

    return ShareListResponse(
        shares=shares,
        total=total,
        has_more=offset + len(shares) < total,
    )
