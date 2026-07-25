"""Public transparency posts for moderation decisions.

Renders moderation events into posts for @moderation.plyr.fm. The policy about
*which* events are publishable lives here rather than at the call site, because
getting it wrong is the failure mode with real consequences.

The rule: publish actions we took, never suspicions we hold.

The 2026-01-02 legal review is the reason. Publicly asserting "this might
infringe" without acting on it creates knowledge without action, which is the
wrong side of safe harbour — and it is also just unfair to an uploader whose
track matched a fingerprint and turned out to be their own cover. A flag is not
a finding, so a flag is not publishable. Neither is a user report: announcing
that someone reported a track exposes the target before anyone has reviewed it,
and turns the report button into a way to publicly stain a rival.

What is left is the set of actions whose *effects* are already visible — a
track that stopped appearing, a label anyone can query — where a post explains
something the public can otherwise only guess at.
"""

from dataclasses import dataclass
from typing import Any

# Actions whose effect is already publicly visible, so explaining them adds
# transparency rather than new accusation.
PUBLISHABLE_ACTIONS = frozenset(
    {
        "takedown",
        "override_exclude",
        "label_applied",
        "label_negated",
    }
)

# Deliberately excluded, with the reason each one stays private:
#   flagged_by_scan  suspicion, not a finding — publishing it is the exact
#                    "knowledge without action" the legal review warned about
#   reported         exposes a target before review; would make the report
#                    button a harassment tool
#   acknowledged     reveals that a track was suspected, while saying we found
#                    nothing — all of the stain, none of the finding
#   override_allow   same: it only makes sense to announce if you first
#                    announce the suspicion
#   override_clear   withdraws an internal decision with no public effect

_HEADLINE = {
    "takedown": "removed a track",
    "override_exclude": "removed a track from discovery and radio",
    "label_applied": "labeled a track",
    "label_negated": "withdrew a label from a track",
}

TRACK_URL = "https://plyr.fm/track/{track_id}"
# every post carries this, so a dead link would be a dead link on all of them.
POLICY_URL = "https://docs.plyr.fm/moderation"

# operator-supplied, so bounded. the rest of the post is fixed-length.
REASON_MAX_CHARS = 120


@dataclass(frozen=True)
class Segment:
    """A run of post text, optionally carrying a link.

    The renderer emits segments rather than a finished string because Bluesky
    links are not inferred from the text -- they are `facets`, byte ranges
    attached to the record. A post whose text merely *contains* a URL renders
    as unclickable plain text, which is what shipped first.

    Keeping segments here rather than building facets directly leaves this
    module free of atproto imports, so the publishability policy stays testable
    on its own.
    """

    text: str
    link: str | None = None


@dataclass(frozen=True)
class TransparencyPost:
    """A rendered post, plus the event id that produced it."""

    event_id: int
    segments: tuple[Segment, ...]

    @property
    def text(self) -> str:
        return "".join(segment.text for segment in self.segments)


def is_publishable(event: dict[str, Any]) -> bool:
    return event.get("action") in PUBLISHABLE_ACTIONS


def _display(url: str) -> str:
    """Link text without the scheme, the way Bluesky's own composer shows it."""
    return url.removeprefix("https://").removeprefix("http://")


def render(event: dict[str, Any]) -> TransparencyPost | None:
    """Render one event, or None when it is not publishable.

    Never names the uploader and never mentions a reporter. The track is
    already public and is identified by link; @-mentioning the artist would
    notify and amplify a moderation action against them, which is punishment
    rather than transparency.

    No external embed card either. A card would re-surface the artwork and
    title of content we just removed, which is the opposite of the point.
    """
    if not is_publishable(event):
        return None

    segments: list[Segment] = [Segment(f"moderation: {_HEADLINE[event['action']]}")]

    if reason := event.get("reason"):
        # bounded here rather than by truncating the finished post: facets are
        # byte offsets into the text, so trimming the assembled string would
        # leave every link pointing at the wrong range.
        pretty = reason.replace("_", " ")[:REASON_MAX_CHARS]
        segments.append(Segment(f"\nreason: {pretty}"))

    if track_id := event.get("subject_track_id"):
        url = TRACK_URL.format(track_id=track_id)
        segments.append(Segment("\n"))
        segments.append(Segment(_display(url), link=url))

    segments.append(Segment("\n\n"))
    segments.append(Segment(_display(POLICY_URL), link=POLICY_URL))

    return TransparencyPost(event_id=event["id"], segments=tuple(segments))
