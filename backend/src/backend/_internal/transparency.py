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


@dataclass(frozen=True)
class TransparencyPost:
    """A rendered post, plus the event id that produced it."""

    event_id: int
    text: str


def is_publishable(event: dict[str, Any]) -> bool:
    return event.get("action") in PUBLISHABLE_ACTIONS


def render(event: dict[str, Any]) -> TransparencyPost | None:
    """Render one event, or None when it is not publishable.

    Never names the uploader and never mentions a reporter. The track is
    already public and is identified by link; @-mentioning the artist would
    notify and amplify a moderation action against them, which is punishment
    rather than transparency.
    """
    if not is_publishable(event):
        return None

    action = event["action"]
    lines = [f"moderation: {_HEADLINE[action]}"]

    if reason := event.get("reason"):
        lines.append(f"reason: {reason.replace('_', ' ')}")

    if track_id := event.get("subject_track_id"):
        lines.append(TRACK_URL.format(track_id=track_id))

    lines.append("")
    lines.append("plyr.fm/docs/moderation")

    text = "\n".join(lines)
    # bluesky's limit is 300 graphemes; these are short by construction, but a
    # reason string comes from operator input and is not guaranteed to be.
    if len(text) > 300:
        text = text[:297] + "..."

    return TransparencyPost(event_id=event["id"], text=text)
