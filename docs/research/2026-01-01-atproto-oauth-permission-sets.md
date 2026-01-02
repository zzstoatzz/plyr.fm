# research: ATProto OAuth permission sets

**date**: 2026-01-01
**question**: how do ATProto OAuth permission sets work, and how could plyr.fm adopt them?

## summary

ATProto permission sets are lexicon schemas (`type: "permission-set"`) that bundle OAuth permissions under human-readable titles. they're published to `com.atproto.lexicon.schema` in an authority's ATProto repo and resolved by the PDS during OAuth authorization. plyr.fm currently uses granular `repo:` scopes directly; adopting permission sets would provide better UX and enable per-feature authorization (e.g., separate scopes for developer tokens).

## findings

### how permission sets work

permission sets are lexicon documents with `type: "permission-set"` in `defs.main`. they're published to the `com.atproto.lexicon.schema` collection in an ATProto repo and resolved via the NSID's authority domain.

**resolution flow:**
1. app requests `include:fm.plyr.authBasicFeatures?aud=did:web:api.plyr.fm%23svc_appview` in OAuth scope
2. PDS extracts NSID `fm.plyr.authBasicFeatures`
3. reverses authority: `fm.plyr` → `plyr.fm`
4. resolves `plyr.fm` to a DID via DNS TXT record
5. fetches lexicon from that DID's repo at `com.atproto.lexicon.schema/fm.plyr.authBasicFeatures`
6. displays `title` and `permissions` to user in authorization UI

**real example from Bailey Townsend's repo** (did:plc:rnpkyqnmsw4ipey6eotbdnnf on selfhosted.social):

```json
{
  "id": "dev.baileytownsend.demo.authBasicFeatures",
  "lexicon": 1,
  "$type": "com.atproto.lexicon.schema",
  "defs": {
    "main": {
      "type": "permission-set",
      "title": "Basic App Functionality",
      "description": "An example simple permission set",
      "permissions": [
        {
          "type": "permission",
          "resource": "repo",
          "action": ["create"],
          "collection": ["dev.baileytownsend.demo.example"]
        }
      ]
    }
  }
}
```

### plyr.fm's current OAuth implementation

plyr.fm uses a custom fork of the atproto SDK (`git+https://github.com/zzstoatzz/atproto@main`) with OAuth 2.1 support.

**current scope construction** (`backend/src/backend/config.py:420-441`):

```python
@computed_field
@property
def resolved_scope(self) -> str:
    scopes = [
        f"repo:{self.track_collection}",      # repo:fm.plyr.track
        f"repo:{self.like_collection}",       # repo:fm.plyr.like
        f"repo:{self.comment_collection}",    # repo:fm.plyr.comment
        f"repo:{self.list_collection}",       # repo:fm.plyr.list
        f"repo:{self.profile_collection}",    # repo:fm.plyr.actor.profile
    ]
    return f"atproto {' '.join(scopes)}"
```

**optional teal.fm scopes** (`config.py:443-452`):
```python
def resolved_scope_with_teal(self, teal_play: str, teal_status: str) -> str:
    base = self.resolved_scope
    teal_scopes = [f"repo:{teal_play}", f"repo:{teal_status}"]
    return f"{base} {' '.join(teal_scopes)}"
```

**resulting scope string:**
```
atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment repo:fm.plyr.list repo:fm.plyr.actor.profile
```

### developer tokens

developer tokens are independent OAuth sessions for API/CLI access (`backend/src/backend/api/auth.py:333-374`).

**key differences from regular sessions:**
- separate OAuth grant with independent refresh tokens
- configurable expiration (default 90 days, max 365)
- stored with `is_developer_token=True` flag
- don't set browser cookies on exchange

**current behavior:** dev tokens request the same scopes as regular sessions. with permission sets, we could:
1. define `fm.plyr.authFullApp` for browser sessions (all collections)
2. define `fm.plyr.authDeveloper` for dev tokens (possibly read-heavy, limited write)
3. define `fm.plyr.authReadOnly` for third-party apps (read-only access)

### namespace constraints

permission sets can **only reference resources in the same NSID namespace**. `fm.plyr.authBasicFeatures` can only grant permissions to `fm.plyr.*` collections.

this means:
- teal.fm scopes (`fm.teal.alpha.*`) cannot be bundled in our permission sets
- we'd still need to request teal scopes separately: `include:fm.plyr.authBasicFeatures repo:fm.teal.alpha.feed.play repo:fm.teal.alpha.actor.status`

### publishing permission sets

to publish a permission set, write it to `com.atproto.lexicon.schema` collection:

```python
# pseudocode
await client.com.atproto.repo.putRecord(
    repo=our_did,
    collection="com.atproto.lexicon.schema",
    rkey="fm.plyr.authBasicFeatures",
    record={
        "$type": "com.atproto.lexicon.schema",
        "lexicon": 1,
        "id": "fm.plyr.authBasicFeatures",
        "defs": {
            "main": {
                "type": "permission-set",
                "title": "plyr.fm Music Library",
                "description": "Create and manage your music library",
                "permissions": [...]
            }
        }
    }
)
```

**DNS requirement:** lexicon resolution uses `_lexicon` prefix (distinct from `_atproto` for handles):
- `_lexicon.plyr.fm` → `did=did:plc:vs3hnzq2daqbszxlysywzy54` (production)
- `_lexicon.stg.plyr.fm` → `did=did:plc:vs3hnzq2daqbszxlysywzy54` (staging)

### official bluesky permission sets

bluesky defines several permission sets in their lexicons (`lexicons/app/bsky/`):
- `app.bsky.authFullApp` - full Bluesky app permissions
- `app.bsky.authCreatePosts` - create posts only (no update/delete)
- `app.bsky.authViewAll` - read-only access
- `app.bsky.authManageProfile` - profile management only
- `app.bsky.authManageNotifications` - notification management

these demonstrate the pattern of offering tiered permission levels.

## code references

- `backend/src/backend/config.py:420-452` - current scope construction
- `backend/src/backend/_internal/auth.py:165-194` - OAuth client creation with scopes
- `backend/src/backend/api/auth.py:333-374` - developer token flow
- `backend/src/backend/models/session.py` - session model with `is_developer_token` flag
- `docs/lexicons/overview.md` - current lexicon documentation
- `docs/authentication.md` - OAuth flow documentation

## permission set for plyr.fm

### fm.plyr.authFullApp
full access for the main web app:
```json
{
  "permissions": [
    {
      "type": "permission",
      "resource": "repo",
      "action": ["create", "update", "delete"],
      "collection": [
        "fm.plyr.track",
        "fm.plyr.like",
        "fm.plyr.comment",
        "fm.plyr.list",
        "fm.plyr.actor.profile"
      ]
    }
  ]
}
```

additional permission sets (e.g., listener-only, read-only) can be added when there's a concrete use case.

## resolved questions

1. **DNS setup**: lexicon resolution requires `_lexicon` TXT records (not `_atproto` which is for handles):
   - production: `_lexicon.plyr.fm` → `did=did:plc:vs3hnzq2daqbszxlysywzy54`
   - staging: `_lexicon.stg.plyr.fm` → `did=did:plc:vs3hnzq2daqbszxlysywzy54`

2. **which repo?**: the `plyr.fm` account (did:plc:vs3hnzq2daqbszxlysywzy54) on bsky.network - just publish to `com.atproto.lexicon.schema` collection

3. **SDK support**: the SDK fork at `zzstoatzz/atproto` just passes scope strings to the PDS - permission set resolution is server-side. any PDS supporting OAuth 2.1 should resolve `include:` scopes.

## open questions

1. **teal.fm integration**: since teal scopes can't be in our permission sets (different namespace), keep as granular `repo:` scopes for teal

2. **developer token differentiation**: should dev tokens get different permission sets than browser sessions?

## next steps

1. draft permission set lexicons in `/lexicons/` as JSON files
2. publish to `com.atproto.lexicon.schema` collection on the plyr.fm account
3. update OAuth client to use `include:fm.plyr.authFullApp` scope
4. test with staging environment first
