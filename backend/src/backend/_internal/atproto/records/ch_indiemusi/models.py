"""typed input shapes for the ch.indiemusi.alpha lexicon family.

the API accepts these from the frontend; the build_* helpers in sibling modules
turn validated inputs into the dicts sent to the PDS. royalty percentages are
basis points per the lexicon (10000 = 100%).

format patterns for the registry-issued identifiers (IPI, ISWC, ISRC) are
applied here so invalid values fail fast at the API boundary instead of being
written to the user's PDS as garbage records.
"""

from pydantic import BaseModel, ConfigDict, Field

# IPI Name Number — CISAC-assigned identifier, exactly 11 numeric digits.
# Wikipedia: "The IPI Name Number is composed of eleven numeric digits."
# Leading zeros are part of the canonical form ("01145982828"). The older
# 9-digit CAE numbering was retired in 2001 when the IPI database replaced it.
IPI_PATTERN = r"^\d{11}$"

# ISWC — International Standard Musical Work Code.
# Spec: "T" prefix + 9-digit work identifier + 1 check digit (mod-10).
# 11 chars without separators, 13 with hyphens. We accept the hyphenated form
# T-DDDDDDDDD-C (matches Hilke's storage convention and the lexicon's maxLength
# of 13) or the bare T-prefix form. The period-grouped variant
# T-DDD.DDD.DDD-C is presentation-only and runs to 15 chars — outside the
# lexicon bound, so users should strip dots before submitting.
ISWC_PATTERN = r"^T-?\d{9}-?\d$"

# ISRC — International Standard Recording Code.
# Spec (IFPI): CC (2-letter country, ISO 3166-1 alpha-2 or special codes QM/QZ/
# QT/CP/DG/ZZ) + XXX (3 alphanumeric registrant) + YY (2-digit year) + NNNNN
# (5-digit designation). 12 chars total; hyphens are presentation-only and
# don't fit the lexicon's maxLength=12, so we require the bare 12-char form.
ISRC_PATTERN = r"^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$"


class PublishingOwnerInput(BaseModel):
    """publishingOwner fields — represents a songwriter, composer, or music publisher.

    at least one of (firstName + lastName) or companyName must be set to be
    useful; the lexicon itself marks every field optional.
    """

    model_config = ConfigDict(extra="forbid")

    ipi: str | None = Field(default=None, max_length=11, pattern=IPI_PATTERN)
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
    ipi: str | None = Field(default=None, max_length=11, pattern=IPI_PATTERN)
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
        pattern=ISWC_PATTERN,
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
        pattern=ISRC_PATTERN,
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
