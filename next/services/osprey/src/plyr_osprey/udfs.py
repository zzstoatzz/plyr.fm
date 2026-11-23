"""the UDFs plyr's rules call, and the effect a matched rule leaves behind."""

from dataclasses import dataclass
from typing import List, Self, cast  # noqa: UP035
from urllib.parse import urlsplit

from osprey.engine.executor.custom_extracted_features import CustomExtractedFeature
from osprey.engine.executor.execution_context import ExecutionContext
from osprey.engine.language_types.effects import EffectBase, EffectToCustomExtractedFeatureBase
from osprey.engine.stdlib.udfs.categories import UdfCategories
from osprey.engine.udf.arguments import ArgumentsBase
from osprey.engine.udf.base import UDFBase
from osprey.engine.utils.types import add_slots

from plyr_osprey import evidence, image_scan
from plyr_osprey.fingerprint import Fingerprinter, Unconfigured
from plyr_osprey.image_scan import ImageScanner

# set by register_plugins from the environment; tests swap in fakes
fingerprinter: Fingerprinter = Unconfigured()
image_scanner: ImageScanner = image_scan.Unconfigured()

FLAG_SOURCES = ('scan', 'rule')

# Osprey's validator reads typing.List in a UDF's return type, not list
Lines = List[str]  # noqa: UP006


class HostArguments(ArgumentsBase):
    url: str


class UrlHost(UDFBase[HostArguments, str]):
    """the lowercase host of an https URL, or '' for anything else."""

    category = UdfCategories.STRING

    def execute(self, execution_context: ExecutionContext, arguments: HostArguments) -> str:
        parts = urlsplit(arguments.url)
        return (parts.hostname or '') if parts.scheme == 'https' else ''


class RecordingsArguments(ArgumentsBase):
    audio_url: str
    owner_handle: str
    owner_name: str


class RecordingsPlayingThrough(UDFBase[RecordingsArguments, Lines]):
    """someone else's recordings that play through the audio, one line each.

    fingerprints the audio (AuDD, through plyr's moderation service), keeps
    the recordings that play through for about 48 seconds or fill the upload
    (evidence.song_evidence), and drops the uploader's own catalog. a failed
    scan raises, so nothing downstream reads it as clean.
    """

    category = UdfCategories.ENGINE

    def execute(self, execution_context: ExecutionContext, arguments: RecordingsArguments) -> Lines:
        matches = fingerprinter.matches(arguments.audio_url)
        found = evidence.others_playing_through(matches, arguments.owner_handle, arguments.owner_name)
        return [e.describe() for e in found[:3]]


class CoverArguments(ArgumentsBase):
    image_url: str


class ImagePolicyViolations(UDFBase[CoverArguments, Lines]):
    """what breaks plyr's image policy in a cover, one line; empty when it's fine.

    the scan prod runs on every cover uploaded to it (Claude, through plyr's
    moderation service). a failed scan raises, so nothing downstream reads it
    as clean.
    """

    category = UdfCategories.ENGINE

    def execute(self, execution_context: ExecutionContext, arguments: CoverArguments) -> Lines:
        verdict = image_scanner.verdict(arguments.image_url)
        return [] if verdict.is_safe else [verdict.describe()]


class FlagArguments(ArgumentsBase):
    subject: str
    source: str
    name: str
    evidence: list[str]


@dataclass
class FlagEffect(EffectToCustomExtractedFeatureBase[list[str]]):
    """open a review of `subject` in next's moderation log."""

    subject: str
    source: str
    name: str
    evidence: list[str]

    @property
    def action(self) -> str:
        return 'flagged_by_scan' if self.source == 'scan' else 'flagged_by_rule'

    @property
    def actor(self) -> str:
        return f'{self.source}:{self.name}'

    @property
    def reason(self) -> str:
        return '\n'.join(self.evidence)[:2000]

    def to_str(self) -> str:
        return f'{self.actor}|{self.subject}'

    @classmethod
    def build_custom_extracted_feature_from_list(cls, values: list[Self]) -> CustomExtractedFeature[list[str]]:
        return FlagsExtractedFeature(effects=cast(list[FlagEffect], values))


@add_slots
@dataclass
class FlagsExtractedFeature(CustomExtractedFeature[list[str]]):
    effects: list[FlagEffect]

    @classmethod
    def feature_name(cls) -> str:
        return 'flags'

    def get_serializable_feature(self) -> list[str] | None:
        return [effect.to_str() for effect in self.effects]


class FlagForReview(UDFBase[FlagArguments, EffectBase]):
    """flags a subject for a person to look at. flags never hide anything by themselves."""

    category = UdfCategories.ENGINE

    def execute(self, execution_context: ExecutionContext, arguments: FlagArguments) -> EffectBase:
        if arguments.source not in FLAG_SOURCES:
            raise ValueError(f'flag source must be one of {FLAG_SOURCES}')
        return FlagEffect(
            subject=arguments.subject,
            source=arguments.source,
            name=arguments.name,
            evidence=list(arguments.evidence),
        )
