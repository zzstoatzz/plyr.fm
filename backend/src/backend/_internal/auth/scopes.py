"""OAuth scope parsing and validation using atproto_oauth.scopes."""

from atproto_oauth.scopes import RepoPermission, ScopesSet


def check_scope_coverage(granted_scope: str, required_scope: str) -> bool:
    """check if granted scope covers all required scopes.

    uses ScopesSet for spec-compliant matching: handles positional/query
    format equivalence (``repo:nsid`` == ``repo?collection=nsid``),
    wildcard matching, and action filtering.

    returns True if the session has all required permissions.
    """
    granted = ScopesSet.from_string(granted_scope)
    required_tokens = required_scope.split()

    for token in required_tokens:
        # skip atproto prefix
        if token == "atproto":
            continue

        # for repo scopes, parse and check semantic matching
        if token.startswith("repo"):
            if (req := RepoPermission.from_string(token)) is not None:
                for coll in req.collection:
                    for action in req.action:
                        if not granted.matches("repo", collection=coll, action=action):
                            return False
                continue

        # for other scopes (blob, include, transition, etc.), check exact presence
        if not granted.has(token):
            return False

    return True


def get_missing_scopes(granted_scope: str, required_scope: str) -> set[str]:
    """get the scopes that are required but not granted."""
    granted = ScopesSet.from_string(granted_scope)
    missing: set[str] = set()

    for token in required_scope.split():
        if token == "atproto":
            continue

        if token.startswith("repo"):
            if (req := RepoPermission.from_string(token)) is not None:
                for coll in req.collection:
                    for action in req.action:
                        if not granted.matches("repo", collection=coll, action=action):
                            missing.add(token)
                continue

        if not granted.has(token):
            missing.add(token)

    return missing
