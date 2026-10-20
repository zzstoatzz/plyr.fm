"""Private feedback uses the authenticated account and survives notification failure."""

from collections.abc import Generator
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.notifications import (
    DmMessage,
    NotificationResult,
    notification_service,
)
from backend.models import UploadFeedback
from backend.utilities.rate_limit import limiter

PAUSED_DID = "did:plc:so3ysj7gypel6w7mixdfjhkh"


@pytest.fixture
def feedback_session() -> Session:
    return Session(
        session_id="feedback-test",
        did=PAUSED_DID,
        handle="renamed.example",
        oauth_session={},
    )


@pytest.fixture
def feedback_app(
    fastapi_app: FastAPI,
    db_session: AsyncSession,
    feedback_session: Session,
) -> Generator[FastAPI, None, None]:
    async def authenticated() -> Session:
        return feedback_session

    fastapi_app.dependency_overrides[require_auth] = authenticated
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest.mark.parametrize("notification_fails", [False, True])
async def test_feedback_saved_before_notification(
    feedback_app: FastAPI,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    notification_fails: bool,
) -> None:
    notifications: list[tuple[str, DmMessage]] = []

    async def ready() -> str:
        return "did:plc:operator"

    async def send(recipient_did: str, message: DmMessage) -> NotificationResult:
        notifications.append((recipient_did, message))
        if notification_fails:
            raise ConnectionError("notification provider unavailable")
        return NotificationResult(success=True, recipient_did=recipient_did)

    monkeypatch.setattr(notification_service, "ensure_ready", ready)
    monkeypatch.setattr(notification_service, "_send_dm_to_did", send)
    with TestClient(feedback_app, headers={"fly-client-ip": uuid4().hex}) as client:
        response = client.post(
            "/tracks/me/upload-feedback",
            json={"message": "  please email me at a@example.com  "},
        )
        assert response.status_code == 201, response.text
        assert client.get("/tracks/me/upload-feedback").status_code == 405
    saved = await db_session.get(UploadFeedback, response.json()["id"])
    assert saved is not None
    assert saved.did == PAUSED_DID
    assert saved.handle == "renamed.example"
    assert saved.message == "please email me at a@example.com"
    assert notifications[0][0] == "did:plc:operator"
    assert saved.message in str(notifications[0][1])


@pytest.mark.parametrize(
    "payload",
    [
        {"message": " \n "},
        {"message": "x" * 2001},
        {"message": "hello", "did": "did:plc:someoneelse"},
    ],
)
async def test_invalid_feedback_does_not_write(
    feedback_app: FastAPI,
    db_session: AsyncSession,
    payload: dict[str, str],
) -> None:
    with TestClient(feedback_app, headers={"fly-client-ip": uuid4().hex}) as client:
        assert (
            client.post("/tracks/me/upload-feedback", json=payload).status_code == 422
        )
    assert (
        await db_session.scalar(select(func.count()).select_from(UploadFeedback)) == 0
    )


async def test_only_paused_accounts_can_submit(
    feedback_app: FastAPI,
    db_session: AsyncSession,
    feedback_session: Session,
) -> None:
    feedback_session.did = "did:plc:unpaused"
    with TestClient(feedback_app, headers={"fly-client-ip": uuid4().hex}) as client:
        assert (
            client.post(
                "/tracks/me/upload-feedback", json={"message": "hello"}
            ).status_code
            == 403
        )
    assert (
        await db_session.scalar(select(func.count()).select_from(UploadFeedback)) == 0
    )


async def test_anonymous_feedback_requires_auth(
    fastapi_app: FastAPI,
    db_session: AsyncSession,
) -> None:
    with TestClient(fastapi_app, headers={"fly-client-ip": uuid4().hex}) as client:
        assert (
            client.post(
                "/tracks/me/upload-feedback", json={"message": "hello"}
            ).status_code
            == 401
        )


async def test_feedback_rate_limit(
    feedback_app: FastAPI,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unavailable() -> None:
        return None

    monkeypatch.setattr(notification_service, "ensure_ready", unavailable)
    monkeypatch.setattr(limiter, "enabled", True)
    with TestClient(feedback_app, headers={"fly-client-ip": uuid4().hex}) as client:
        for _ in range(3):
            assert (
                client.post(
                    "/tracks/me/upload-feedback", json={"message": "hello"}
                ).status_code
                == 201
            )
        assert (
            client.post(
                "/tracks/me/upload-feedback", json={"message": "hello"}
            ).status_code
            == 429
        )
    assert (
        await db_session.scalar(select(func.count()).select_from(UploadFeedback)) == 3
    )
