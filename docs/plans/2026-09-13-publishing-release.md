# publishing access production release

Nate approved production deployment and smoke on September 12 (local time).
The release includes #2047, #2049, #2053, #2054 and #2048, plus commits already
on main for musician-studio. Use the normal full release because backend code
and migration 311b4f106c90 changed.

## migration and blast radius

Before deployment on September 13 UTC, production is at a81c2d9e4f07:
1,017 public tracks, 42 unlisted, four supporter-gated, and three private.
The private tracks use PDS storage. The migration snapshots download defaults,
preserves gate refusals, moves legacy supporter metadata to public visibility
with a separate gate, and leaves native Space authorization intact.

The migration does not copy or delete audio or migrate anything into Spaces.
Formerly public files cannot be recalled. Downgrade deliberately refuses:
repair forward rather than dropping per-work policies or restoring an old app
that expects the removed preferences column. Neon retention is six hours at
preflight; a database restore would also lose subsequent writes and is not a
routine code rollback.

## client and docs

plyr-python-client#42 removes obsolete unlisted write flags and accepts a complete
publishing override across sync/async SDK and CLI. 59 tests and Python 3.10/3.12
CI pass, including current-backend compatibility. Publish the matching package
release with the production rollout.

Creator, listener, glossary, upload, metadata-editing, developer publishing and
LLM discovery docs are updated. No compatibility translation is added.

## verification

Staging evidence: 19 real uploads, original-file protection, discovery, all five
radio stations, and Nate's separate-account acceptance. Native positive
supporter/Space-member browser coverage remains limited. The private-upload
OAuth CI failure is not a passing end-to-end check; manual staging coverage
is recorded separately. UI follow-ups have 259 passing frontend tests.

Production smoke:
- wait for backend migration/deployment and frontend Pages deployment;
- compare migrated catalog aggregates and native-private counts;
- anonymous feed, radio, public detail, playback, download policy and private denial;
- browser signed-out player like CTA with return-to-track login link;
- authenticated test upload with integration-test tag, downloads off/public listen,
  verify owner access, anonymous rendition and original refusal;
- review production errors after rollout and record fixture IDs and release tag.

Never omit integration-test on smoke uploads: it suppresses notification DMs and
copyright scans. Do not change global alerting. Do not reuse a production
artist's real tracks for mutation probes.
