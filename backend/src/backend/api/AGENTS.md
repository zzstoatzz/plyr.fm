# API

- `/oauth-client-metadata.json` (`meta.py`) publishes the **universe** of scopes
  this client may ever request. authservers reject any PAR with a scope not
  in this universe, so whenever you add a new integration's scopes to the
  runtime composer in `AtprotoSettings.resolved_scope_with_extras`, you MUST
  also add them here. regression: `tests/api/test_oauth_client_metadata.py`
