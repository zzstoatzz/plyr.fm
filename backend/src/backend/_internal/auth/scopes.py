"""OAuth scope parsing and validation."""


def _parse_scopes(scope_string: str) -> set[str]:
    """parse an OAuth scope string into a set of individual scopes.

    handles format like: "atproto repo:fm.plyr.track repo:fm.plyr.like"
    returns: {"repo:fm.plyr.track", "repo:fm.plyr.like"}
    """
    parts = scope_string.split()
    # filter out the "atproto" prefix and keep just the repo: scopes
    return {p for p in parts if p.startswith("repo:")}


def _check_scope_coverage(granted_scope: str, required_scope: str) -> bool:
    """check if granted scope covers all required scopes.

    returns True if the session has all required permissions.
    """
    granted = _parse_scopes(granted_scope)
    required = _parse_scopes(required_scope)
    return required.issubset(granted)


def _get_missing_scopes(granted_scope: str, required_scope: str) -> set[str]:
    """get the scopes that are required but not granted."""
    granted = _parse_scopes(granted_scope)
    required = _parse_scopes(required_scope)
    return required - granted
