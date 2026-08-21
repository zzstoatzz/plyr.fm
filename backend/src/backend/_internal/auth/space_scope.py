"""``space:`` OAuth scope parsing and matching.

Mirrors ``SpacePermission`` from ``@atproto/oauth-scopes`` on the
``permissioned-data`` branch; ``atproto_oauth.scopes`` does not know this
resource yet.
"""

import re
from dataclasses import dataclass
from typing import Literal

from atproto_core.nsid import validate_nsid
from atproto_oauth.scopes._parser import ParamSchema, Parser
from atproto_oauth.scopes._syntax import ScopeStringSyntax
from atproto_oauth.scopes.scopes_set import ScopesSet

from backend.config import settings

SPACE_ACTIONS = ("read_self", "read", "create", "update", "delete")
SPACE_DEFAULT_ACTIONS = ("read", "create", "update", "delete")
SPACE_MANAGE_OPS = ("create", "update", "delete")

SpaceAction = Literal["read_self", "read", "create", "update", "delete"]
SpaceManageOp = Literal["create", "update", "delete"]

_DID_RE = re.compile(r"^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._%-]$")
_RKEY_RE = re.compile(r"^[a-zA-Z0-9._:~-]{1,512}$")
_EMPTY_PARAM_RE = re.compile(r"[?&][a-z]+=(?:&|$)")


def _is_nsid(value: str) -> bool:
    return validate_nsid(value, soft_fail=True)


def _is_nsid_or_wildcard(value: str) -> bool:
    return value == "*" or _is_nsid(value)


def _is_authority(value: str) -> bool:
    return value in ("*", "self") or bool(_DID_RE.match(value))


def _is_record_key(value: str) -> bool:
    return value not in (".", "..") and bool(_RKEY_RE.match(value))


def _is_skey(value: str) -> bool:
    return value == "*" or _is_record_key(value)


def _normalize_collections(value: list[str]) -> list[str]:
    if len(value) > 1:
        return ["*"] if "*" in value else sorted(set(value))
    return value


_space_parser = Parser(
    "space",
    {
        "type": ParamSchema(
            multiple=False, required=True, validate=_is_nsid_or_wildcard
        ),
        "authority": ParamSchema(
            multiple=False, required=False, validate=_is_authority, default="self"
        ),
        "skey": ParamSchema(
            multiple=False, required=False, validate=_is_skey, default="*"
        ),
        "collection": ParamSchema(
            multiple=True,
            required=False,
            validate=_is_nsid_or_wildcard,
            default=[],
            normalize=_normalize_collections,
        ),
        "action": ParamSchema(
            multiple=True,
            required=False,
            validate=lambda v: v in SPACE_ACTIONS,
            default=list(SPACE_DEFAULT_ACTIONS),
            normalize=lambda value: [a for a in SPACE_ACTIONS if a in value],
        ),
        "manage": ParamSchema(
            multiple=True,
            required=False,
            validate=lambda v: v in SPACE_MANAGE_OPS,
            default=[],
            normalize=lambda value: [m for m in SPACE_MANAGE_OPS if m in value],
        ),
    },
    positional_name="type",
)


@dataclass(frozen=True)
class SpacePermission:
    """One granted ``space:`` scope."""

    type: str
    authority: str
    skey: str
    collection: tuple[str, ...]
    action: tuple[str, ...]
    manage: tuple[str, ...]

    @classmethod
    def from_string(cls, scope: str) -> "SpacePermission | None":
        if scope != "space" and not scope.startswith(("space:", "space?")):
            return None
        if _EMPTY_PARAM_RE.search(scope):
            return None
        parsed = _space_parser.parse(ScopeStringSyntax.from_string(scope))
        if parsed is None:
            return None
        return cls(
            type=parsed["type"],
            authority=parsed["authority"],
            skey=parsed["skey"],
            collection=tuple(parsed["collection"]),
            action=tuple(parsed["action"]),
            manage=tuple(parsed["manage"]),
        )

    def __str__(self) -> str:
        return _space_parser.format(
            {
                "type": self.type,
                "authority": self.authority,
                "skey": self.skey,
                "collection": list(self.collection),
                "action": list(self.action),
                "manage": list(self.manage),
            }
        )

    @property
    def is_self_authority(self) -> bool:
        return self.authority == "self"

    def with_resolved_authority(self, user_did: str) -> "SpacePermission":
        if not self.is_self_authority:
            return self
        return SpacePermission(
            self.type, user_did, self.skey, self.collection, self.action, self.manage
        )

    def matches(
        self,
        *,
        type: str,
        authority: str,
        skey: str,
        action: SpaceAction | None = None,
        collection: str | None = None,
        manage: SpaceManageOp | None = None,
    ) -> bool:
        """Whether this grant covers one concrete operation.

        An unresolved ``self`` authority matches nothing: ``authority`` is
        always a concrete DID. Reads are collection-independent and ``read``
        implies ``read_self``; writes need the action and the collection.
        """
        if self.type != "*" and self.type != type:
            return False
        if self.authority != "*" and self.authority != authority:
            return False
        if self.skey != "*" and self.skey != skey:
            return False
        if action is None:
            return manage is not None and manage in self.manage
        if action == "read":
            return "read" in self.action
        if action == "read_self":
            return "read" in self.action or "read_self" in self.action
        if collection is None:
            return False
        return action in self.action and (
            "*" in self.collection or collection in self.collection
        )


def space_grants(scope: str) -> list[SpacePermission]:
    """Every parseable ``space:`` grant in a granted scope string."""
    return [
        grant
        for token in ScopesSet.from_string(scope)
        if (grant := SpacePermission.from_string(token)) is not None
    ]


def allows_space(
    scope: str,
    *,
    type: str,
    authority: str,
    skey: str,
    action: SpaceAction | None = None,
    collection: str | None = None,
    manage: SpaceManageOp | None = None,
) -> bool:
    """Whether any grant in ``scope`` covers the operation."""
    return any(
        grant.matches(
            type=type,
            authority=authority,
            skey=skey,
            action=action,
            collection=collection,
            manage=manage,
        )
        for grant in space_grants(scope)
    )


def private_media_grant_present(scope: str, did: str) -> bool:
    """whether ``scope`` carries the expanded private-media grant for ``did``."""
    space_type = settings.atproto.private_media_space_type
    return allows_space(
        scope, type=space_type, authority=did, skey="self", manage="create"
    ) and allows_space(
        scope,
        type=space_type,
        authority=did,
        skey="self",
        action="create",
        collection=settings.atproto.track_collection,
    )


def private_media_reader_grant_present(scope: str) -> bool:
    """whether ``scope`` lets this session read private-media spaces of *other*
    authorities — the grant a member needs to play what an artist shared."""
    space_type = settings.atproto.private_media_space_type
    return any(
        grant.type in ("*", space_type)
        and grant.authority == "*"
        and grant.skey in ("*", "self")
        and "read" in grant.action
        for grant in space_grants(scope)
    )


def permissioned_scope_requested(scope: str) -> bool:
    """whether a scope string asks for (``include:``) or carries (``space:``) private media."""
    if ScopesSet.from_string(scope).has(settings.atproto.private_media_include_scope):
        return True
    space_type = settings.atproto.private_media_space_type
    return any(grant.type == space_type for grant in space_grants(scope))
