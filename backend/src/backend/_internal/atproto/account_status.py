"""what an ATProto `#account` event actually tells us.

the event's `active` flag is a statement about *the host that emitted it*, not
about the account. from `com.atproto.sync.subscribeRepos#account`:

    The semantics of this event are that the status is at the host which
    emitted the event, not necessarily that at the currently active PDS. Eg, a
    Relay takedown would emit a takedown with active=false, even if the PDS is
    still active.

so `active=false` means "this host cannot serve this repo right now", and
`status` says why. the reasons are not equivalent: two of them describe the
account, two describe a moderation decision, and two describe infrastructure
having a bad day. collapsing all six into one boolean is how a PDS restart
came to hide an artist's catalogue.
"""

from typing import Final

# the account itself is gone or withdrawn — by the person, or by their host.
# hiding their content follows from the account's own state.
ACCOUNT_LEVEL_STATUSES: Final[frozenset[str]] = frozenset(
    {
        "deactivated",  # the person's own choice, reversible
        "deleted",  # the account is gone
        "takendown",  # moderation, by the emitting host
        "suspended",  # moderation, by the emitting host
    }
)

# the repo is temporarily unfetchable from this host. says nothing about the
# person, and must never affect what we show — their audio lives in our bucket
# and plays fine regardless of what their PDS is doing.
INFRASTRUCTURE_STATUSES: Final[frozenset[str]] = frozenset(
    {
        "throttled",
        "desynchronized",
    }
)


def hides_content(active: bool, status: str | None) -> bool:
    """should this account's content drop out of discovery?

    only for account-level states. an infrastructure status never hides
    anyone, and neither does an `active=false` with no reason given — the
    field is optional in the lexicon, and "some host said no, and wouldn't
    say why" is not grounds for removing someone's music from the platform.
    """
    if active:
        return False
    return status in ACCOUNT_LEVEL_STATUSES
