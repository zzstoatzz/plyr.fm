---
description: Enable a feature flag for a user
argument-hint: <flag_name> for <handle>
---

Enable feature flag: $ARGUMENTS

Use the Neon MCP `run_sql` tool against the dev database (`muddy-flower-98795112`). Look up the DID from the `artists` table by handle, then insert into `feature_flags`:

```sql
INSERT INTO feature_flags (user_did, flag, created_at) VALUES ('<did>', '<flag>', NOW())
ON CONFLICT (user_did, flag) DO NOTHING
```

Known flags: check `KNOWN_FLAGS` in `backend/src/backend/_internal/feature_flags.py`.
