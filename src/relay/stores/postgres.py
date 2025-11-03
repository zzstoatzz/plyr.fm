"""Postgres-backed stores for OAuth state and sessions."""

from datetime import UTC, datetime

from atproto_oauth.models import OAuthState
from atproto_oauth.stores.base import StateStore
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey
from sqlalchemy import delete, select

from relay.models.oauth_state import OAuthStateModel
from relay.utilities.database import db_session


class PostgresStateStore(StateStore):
    """Postgres-backed OAuth state store for CSRF protection.

    Stores temporary OAuth state during authorization flow.
    States should be cleaned up after successful callback or after TTL expires (10 minutes).
    """

    async def save_state(self, state: OAuthState) -> None:
        """Save OAuth state to database."""
        # serialize DPoP private key to PEM
        dpop_key_pem = state.dpop_private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        async with db_session() as db:
            db_state = OAuthStateModel(
                state=state.state,
                pkce_verifier=state.pkce_verifier,
                redirect_uri=state.redirect_uri,
                scope=state.scope,
                authserver_iss=state.authserver_iss,
                dpop_private_key_pem=dpop_key_pem,
                dpop_authserver_nonce=state.dpop_authserver_nonce,
                did=state.did,
                handle=state.handle,
                pds_url=state.pds_url,
                created_at=state.created_at,
            )
            db.add(db_state)
            await db.commit()

    async def get_state(self, state_key: str) -> OAuthState | None:
        """Retrieve OAuth state by key."""
        async with db_session() as db:
            result = await db.execute(
                select(OAuthStateModel).where(OAuthStateModel.state == state_key)
            )
            db_state = result.scalar_one_or_none()

            if not db_state:
                return None

            # deserialize DPoP private key from PEM
            dpop_private_key = serialization.load_pem_private_key(
                db_state.dpop_private_key_pem.encode("utf-8"),
                password=None,
                backend=default_backend(),
            )

            if not isinstance(dpop_private_key, EllipticCurvePrivateKey):
                raise ValueError("Expected EllipticCurvePrivateKey")

            return OAuthState(
                state=db_state.state,
                pkce_verifier=db_state.pkce_verifier,
                redirect_uri=db_state.redirect_uri,
                scope=db_state.scope,
                authserver_iss=db_state.authserver_iss,
                dpop_private_key=dpop_private_key,
                dpop_authserver_nonce=db_state.dpop_authserver_nonce,
                did=db_state.did,
                handle=db_state.handle,
                pds_url=db_state.pds_url,
                created_at=db_state.created_at,
            )

    async def delete_state(self, state_key: str) -> None:
        """Delete OAuth state by key."""
        async with db_session() as db:
            await db.execute(
                delete(OAuthStateModel).where(OAuthStateModel.state == state_key)
            )
            await db.commit()

    async def cleanup_expired_states(self, ttl_seconds: int = 600) -> int:
        """Delete OAuth states older than TTL (default 10 minutes).

        Returns number of states deleted.
        """
        cutoff_time = datetime.now(UTC).timestamp() - ttl_seconds
        cutoff_datetime = datetime.fromtimestamp(cutoff_time, UTC)

        async with db_session() as db:
            result = await db.execute(
                delete(OAuthStateModel)
                .where(OAuthStateModel.created_at < cutoff_datetime)
                .returning(OAuthStateModel.state)
            )
            deleted_count = len(result.fetchall())
            await db.commit()
            return deleted_count
