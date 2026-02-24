"""OAuth scope parsing and validation using atproto_oauth.scopes."""

from atproto_oauth.scopes import IncludeScope, RepoPermission, ScopesSet


def _include_covered_by_granted(inc: IncludeScope, granted: ScopesSet) -> bool:
    """check if an include: scope is covered by the granted set.

    PDS servers expand ``include:ns.permSet`` into granular ``repo:``/``rpc:``
    scopes, so the granted set will never contain the literal ``include:`` token.
    instead, check that the granted set has at least one repo or rpc scope whose
    collection/lxm is in the same namespace authority as the include scope.
    """
    for scope_str in granted:
        if (rp := RepoPermission.from_string(scope_str)) is not None:
            if any(inc.is_parent_authority_of(c) for c in rp.collection if c != "*"):
                return True
    return False


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

        # include: scopes get expanded by the PDS into repo:/rpc: scopes,
        # so the granted set won't contain the literal include: token.
        # check namespace authority instead.
        if token.startswith("include:"):
            if (inc := IncludeScope.from_string(token)) is not None:
                if _include_covered_by_granted(inc, granted):
                    continue
                return False

        # for other scopes (blob, transition, etc.), check exact presence
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

        if token.startswith("include:"):
            if (inc := IncludeScope.from_string(token)) is not None:
                if not _include_covered_by_granted(inc, granted):
                    missing.add(token)
                continue

        if not granted.has(token):
            missing.add(token)

    return missing
