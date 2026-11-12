# track download preferences

`access.download_policy` carries the verified track record's `downloadPolicy`.
It is a preference, not permission to bypass effective listening access or
moderation. Consumers must refresh current access and refuse unknown policies.
The existing ingestion default is `open` when the field is absent on a public
audio record, and `off` when `audioSpace` is present. Explicit future values are
preserved rather than treated as open.

Migration 0038 leaves older projections null. Authenticated replay fills the
preference, including an idempotent replay of the same record CID; it does not
change service-owned visibility or moderation. Null remains unavailable until
verified replay. Deletion and replacement clear stale values atomically.
Changing an application download preference cannot revoke copies or previously
published public audio URLs. Protected/supporter download authorization and
original-file delivery remain separate requirements.
