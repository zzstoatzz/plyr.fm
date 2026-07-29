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


async def repo_is_live_on_current_pds(did: str) -> bool | None:
    """ask the DID's *current* PDS whether it serves this repo.

    an `#account` event is emitted by some host, and the lexicon is explicit
    that this need not be the account's current PDS. the common case in
    practice is migration: leaving a host deactivates the repo there, so the
    host you left correctly announces `deactivated` while the account is alive
    somewhere else. every artist wrongly hidden on plyr got there this way.

    returns True/False when the current PDS answers, None when we cannot tell —
    and "cannot tell" must never be read as "gone".
    """
    import httpx

    from backend._internal.slingshot import resolve_mini_doc_safe

    if not (mini_doc := await resolve_mini_doc_safe(did)):
        return None
    if not (pds := mini_doc.get("pds")):
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{pds}/xrpc/com.atproto.sync.getRepoStatus", params={"did": did}
            )
        if r.status_code != 200:
            return None
        body = r.json()
        return not hides_content(body.get("active", True), body.get("status"))
    except Exception:
        return None


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
