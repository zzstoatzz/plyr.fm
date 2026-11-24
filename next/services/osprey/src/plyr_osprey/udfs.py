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

from plyr_osprey import budget as scan_budget
from plyr_osprey import evidence, image_scan
from plyr_osprey.budget import Budget
from plyr_osprey.fingerprint import Fingerprinter, Prober, ScanPlan, Unconfigured, Unmeasured
from plyr_osprey.image_scan import ImageScanner

# set by register_plugins from the environment; tests swap in fakes
fingerprinter: Fingerprinter = Unconfigured()
image_scanner: ImageScanner = image_scan.Unconfigured()
budget: Budget = scan_budget.Unconfigured()
prober: Prober = Unmeasured()

# the plan SpendScanBudget paid for, by audio URL, for the scan that follows it
# in the same run (rules run one record at a time)
_paid: dict[str, ScanPlan] = {}


def _plan(audio_url: str, claimed_seconds: int) -> ScanPlan:
    return ScanPlan.for_length(prober.seconds(audio_url), claimed_seconds)


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


class BudgetArguments(ArgumentsBase):
    audio_url: str
    owner_did: str
    duration_seconds: int


class SpendScanBudget(UDFBase[BudgetArguments, bool]):
    """spends the uploader's scan budget for this audio's measured length
    (budget.py, fingerprint.ScanPlan), or returns false when the account, or
    everyone together, is out of it for the day."""

    category = UdfCategories.ENGINE

    def execute(self, execution_context: ExecutionContext, arguments: BudgetArguments) -> bool:
        _paid.clear()
        plan = _plan(arguments.audio_url, arguments.duration_seconds)
        granted = budget.spend(arguments.owner_did, plan.charge_seconds)
        if granted:
            _paid[arguments.audio_url] = plan
        return granted


class RecordingsArguments(ArgumentsBase):
    audio_url: str
    owner_did: str
    owner_handle: str
    owner_name: str
    duration_seconds: int


class RecordingsPlayingThrough(UDFBase[RecordingsArguments, Lines]):
    """someone else's recordings that play through the audio, one line each.

    fingerprints the audio with AuDD as the budget paid for it (sampling a
    long file, fingerprint.ScanPlan), keeps the recordings that play through
    for about 48 seconds or fill the upload (evidence.song_evidence), and
    drops the uploader's own catalog. a failed scan gives the budget back and
    raises, so nothing downstream reads it as clean.
    """

    category = UdfCategories.ENGINE

    def execute(self, execution_context: ExecutionContext, arguments: RecordingsArguments) -> Lines:
        plan = _paid.pop(arguments.audio_url, None) or _plan(arguments.audio_url, arguments.duration_seconds)
        try:
            matches = fingerprinter.matches(arguments.audio_url, plan)
        except Exception:
            budget.release(arguments.owner_did, plan.charge_seconds)
            raise
        found = evidence.others_playing_through(matches, arguments.owner_handle, arguments.owner_name, plan.stride)
        return [e.describe() for e in found[:3]]


class CoverArguments(ArgumentsBase):
    image_url: str


class ImagePolicyViolations(UDFBase[CoverArguments, Lines]):
    """what breaks plyr's image policy in a cover, one line; empty when it's fine.

    the scan prod runs on every cover uploaded to it, asked of Claude directly.
    a failed scan raises, so nothing downstream reads it
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


class HoldArguments(ArgumentsBase):
    subject: str


@dataclass
class HoldEffect(EffectToCustomExtractedFeatureBase[list[str]]):
    """keep `subject` out of discovery until its scan can be paid for."""

    subject: str

    def to_str(self) -> str:
        return self.subject

    @classmethod
    def build_custom_extracted_feature_from_list(cls, values: list[Self]) -> CustomExtractedFeature[list[str]]:
        return HoldsExtractedFeature(effects=cast(list[HoldEffect], values))


@add_slots
@dataclass
class HoldsExtractedFeature(CustomExtractedFeature[list[str]]):
    effects: list[HoldEffect]

    @classmethod
    def feature_name(cls) -> str:
        return 'holds'

    def get_serializable_feature(self) -> list[str] | None:
        return [effect.to_str() for effect in self.effects]


class HoldForScan(UDFBase[HoldArguments, EffectBase]):
    """holds a track out of discovery (feeds, search, radio) until it is scanned;
    it still plays from its artist's page and its own link."""

    category = UdfCategories.ENGINE

    def execute(self, execution_context: ExecutionContext, arguments: HoldArguments) -> EffectBase:
        return HoldEffect(subject=arguments.subject)
