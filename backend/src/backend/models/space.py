"""permissioned-data Space, SpaceMember, SpaceRecord models.

backend-side scaffolding aligned to atproto's permissioned-data ("spaces") spec
in https://github.com/bluesky-social/atproto/compare/permissioned-data .

shape mirrors the protocol:
  Space          = (owner_did, type_nsid, skey)
  SpaceMember    = (space_uri, did)               -- flat: no read/write, no tier
  SpaceRecord    = (space_uri, writer_did, collection, rkey, value)

today these tables back features like private playlists at the app layer.
when atproto permissioned data ships, the storage layer swaps to PDS XRPC
calls; the records and member list move out of postgres into per-actor
permissioned repos. record/member shape stays the same.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class Space(Base):
    """a permissioned-data space.

    addressed today as ``plyr-space://<owner_did>/<type>/<skey>``;
    will become ``ats://<owner_did>/<type>/<skey>`` when the protocol lands.
    """

    __tablename__ = "spaces"

    uri: Mapped[str] = mapped_column(String, primary_key=True)
    owner_did: Mapped[str] = mapped_column(
        String, ForeignKey("artists.did"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    skey: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("owner_did", "type", "skey", name="uq_spaces_owner_type_skey"),
        Index("ix_spaces_type", "type"),
    )


class SpaceMember(Base):
    """membership of a DID in a space.

    flat by design — no read/write distinction, no tier. matches the protocol.
    tiered access = multiple separate spaces, not a column on this table.
    """

    __tablename__ = "space_members"

    space_uri: Mapped[str] = mapped_column(
        String, ForeignKey("spaces.uri", ondelete="CASCADE"), primary_key=True
    )
    did: Mapped[str] = mapped_column(String, primary_key=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )


class SpaceRecord(Base):
    """a record stored in a permissioned space.

    keyed by (space, collection, rkey) like a public repo record. ``value``
    holds the CBOR-equivalent JSON payload. ``writer_did`` is the member
    who authored it; today equal to the space owner for owner-only spaces,
    but kept distinct so multi-member spaces work without schema change.
    """

    __tablename__ = "space_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    space_uri: Mapped[str] = mapped_column(
        String, ForeignKey("spaces.uri", ondelete="CASCADE"), nullable=False
    )
    writer_did: Mapped[str] = mapped_column(String, nullable=False)
    collection: Mapped[str] = mapped_column(String, nullable=False)
    rkey: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "space_uri",
            "collection",
            "rkey",
            name="uq_space_records_uri_collection_rkey",
        ),
        Index("ix_space_records_space_collection", "space_uri", "collection"),
    )
