"""typed input shapes for the ch.indiemusi.alpha lexicon family.

the API accepts these from the frontend; the build_* helpers in sibling modules
turn validated inputs into the dicts sent to the PDS. royalty percentages are
basis points per the lexicon (10000 = 100%).
"""

from pydantic import BaseModel, ConfigDict, Field


class PublishingOwnerInput(BaseModel):
    """publishingOwner fields — represents a songwriter, composer, or music publisher.

    at least one of (firstName + lastName) or companyName must be set to be
    useful; the lexicon itself marks every field optional.
    """

    model_config = ConfigDict(extra="forbid")

    ipi: str | None = Field(default=None, max_length=11)
    first_name: str | None = Field(default=None, max_length=255, alias="firstName")
    last_name: str | None = Field(default=None, max_length=255, alias="lastName")
    company_name: str | None = Field(default=None, max_length=255, alias="companyName")
    collecting_society: str | None = Field(
        default=None, max_length=255, alias="collectingSociety"
    )


class InterestedPartyInput(BaseModel):
    """one entry in a song's interestedParties array.

    a co-writer/composer/publisher contributing to the song. royalty percentages
    are basis points (4750 = 47.50%). did and publishingOwner are optional —
    co-writers without an atproto identity can still be entered freeform.
    """

    model_config = ConfigDict(extra="forbid")

    did: str | None = Field(default=None, pattern=r"^did:[a-z]+:.+$")
    ipi: str | None = Field(default=None, max_length=11)
    name: str | None = Field(default=None, max_length=255)
    role: str | None = Field(
        default=None,
        max_length=255,
        description="Role of the interested party (e.g., 'author', 'composer', 'publisher')",
    )
    publishing_owner: PublishingOwnerInput | None = Field(
        default=None, alias="publishingOwner"
    )
    collecting_society: str | None = Field(
        default=None, max_length=255, alias="collectingSociety"
    )
    mechanical_royalties_percentage: int | None = Field(
        default=None,
        ge=0,
        le=10000,
        alias="mechanicalRoyaltiesPercentage",
        description="Basis points; 10000 = 100%.",
    )
    performance_royalties_percentage: int | None = Field(
        default=None,
        ge=0,
        le=10000,
        alias="performanceRoyaltiesPercentage",
        description="Basis points; 10000 = 100%.",
    )


class SongInput(BaseModel):
    """song (composition) record input."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    iswc: str | None = Field(
        default=None,
        max_length=13,
        description="ISWC (International Standard Musical Work Code).",
    )
    interested_parties: list[InterestedPartyInput] = Field(
        min_length=1, alias="interestedParties"
    )


class RecordingArtistInput(BaseModel):
    """one entry in a recording's artists array."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    did: str | None = Field(default=None, pattern=r"^did:[a-z]+:.+$")


class MasterOwnerInput(BaseModel):
    """recording.masterOwner — the entity that owns the master recording rights."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    did: str | None = Field(default=None, pattern=r"^did:[a-z]+:.+$")


class RecordingInput(BaseModel):
    """recording (master) record input.

    `song` is the inline song object (the lexicon ref is an inline shape, not a
    strongRef — Hilke's own records inline the full song into every recording).
    we accept the song fields here and the writer composes the record.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    artists: list[RecordingArtistInput] = Field(min_length=1)
    isrc: str | None = Field(
        default=None,
        max_length=12,
        description="ISRC (International Standard Recording Code).",
    )
    duration: int | None = Field(
        default=None, ge=0, description="Duration of the recording in seconds."
    )
    master_owner: MasterOwnerInput | None = Field(default=None, alias="masterOwner")
    song: SongInput | None = Field(
        default=None,
        description="Optional inline song object. When present, written alongside on the recording record.",
    )
