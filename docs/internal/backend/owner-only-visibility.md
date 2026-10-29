---
title: "Owner-only visibility audit"
---

## Incident

Track 1656 changed from public listening, downloads off to owner-only listening.
Its audio already lived in private R2, so this succeeded without PDS Spaces.
A public `com.atproto.repo.getRecord` read also confirmed its title and
`supportGate: {type: owner}` remain visible on pds.zzstoatzz.io.
Anonymous streaming refused access, but stored visibility remained public.
Discovery used visibility alone; public metadata disclosed the listening policy,
and the frontend repeated it in a toast with a useless sign-in action.

## Contract and fixes

Owner-only listening now makes a work visible only to its artist within plyr,
regardless of its stored visibility or download preference. The artist retains
access. Space privacy continues to consult the Space authority; holding an
artist's Space credential never grants access to their owner-only works.
Public and intentionally gated signed-in/supporter works keep their behavior.

The audit found separate consumers of the old Space-only definition: SQL list
filters, direct-resource guards, search/album/tag counts, activity feed and chart
SQL, saved queue hydration, jam hydration, cached radio rotations and public
post-create hooks. These now enforce the same owner-only exclusion. Queue cache
hits rehydrate current metadata; radio checks current eligibility even when its
rotation is cached. Discovery and album cache keys change to discard old payloads.
Access-change jobs already invalidate discovery and the affected album cache.

Stale owner-only and Space UI entries report `track unavailable` without naming
the private policy or suggesting sign-in/payment. Owner-only editing hides the
inapplicable feed toggle and explains the limit on previously published metadata.

## Boundaries

This does not rewrite the artist's public ATProto record or erase copies others
already read. The public record for this non-Spaces account continues to exist.
No conversion to member-private Space storage is implied. Private R2 was already
in use before the access change; this incident did not demonstrate a public-to-
private blob migration. Previously issued signed URLs and already downloaded
bytes cannot be recalled by changing the current authorization checks.

## Regression evidence

The initial real-Postgres/Redis regression run failed 12 of 13 checks: anonymous
and unrelated-viewer visibility, feed/search/activity, detail/comments/likers,
stream URL, stream and download. Owner visibility passed. Coverage also exercises
cached queues and radio after access changes, historical activity after owner or
Space restriction, and suppression of owner-only upload hooks. Existing Space
membership, signed-in and supporter tests remain in the full backend suite.
