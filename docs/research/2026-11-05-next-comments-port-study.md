# Timed comments in the Next rewrite

Comments need a real port, not a button pointed at the Python API. The existing
canonical record is usable; artist permission is the missing ownership contract.
This is a source/history study and proposed scope, not an implementation plan
approved for runtime changes.

## Existing behavior and ownership

[The original feature (#359)](https://github.com/zzstoatzz/plyr.fm/pull/359)
introduced opt-in comments, at most 20 per track through the application API,
chronological playback-position ordering, author deletion, and timestamp seeking.
[`lexicons/comment.json`](../../lexicons/comment.json) defines `fm.plyr.comment`:
`subject` is a track URI/CID strong reference, `text` is 1–1000 UTF-8 bytes,
`timestampMs` is a nonnegative integer, `createdAt` is required, and `updatedAt`
is optional. Records belong to the commenting author's PDS, not the track owner.

Artist opt-in is **only** `user_preferences.allow_comments` in PostgreSQL, false
by default. The settings toggle writes that private application preference.
Neither `fm.plyr.actor.profile` nor the Next private preference schema currently
publishes a comments policy. The appview cannot infer public permission from a
private Space. An existing artist's legacy opt-in cannot be recreated from their
public repository without an explicit new owner action.

The Python comment API checks track visibility and artist opt-in on reads and
creation, joins author profiles, sorts by timestamp, and restricts edit/delete to
the author. Text edits preserve the playback position and original creation time.
A disabled artist hides all comments, including existing ones; it does not delete
the authors' records. The frontend uses zero for an untimed comment when the track
is not loaded and otherwise captures that track's current media position.

Python's Jetstream subscriptions already include the environment-specific comment
collection. External PDS create/update/delete events are ingested, so this is not
an exclusively first-party feature. But that path is weaker than the API: it
resolves the subject by URI, does not enforce the artist opt-in or 20-comment
limit, does not validate the subject CID against a known track revision, and an
update to a previously unknown comment is dropped rather than upserted. These
are behaviors to correct, not requirements to preserve.

The moderation service accepts reports with target type `comment` and an optional
subject URI. That does not mean display filtering is complete: the Python comment
list does not consult comment labels, and the old report proxy only resolves a
canonical target URI for numeric track reports. A Next comment action must not
claim report/hide support until actual URI-targeted moderation and read filtering
are connected.

## History worth preserving

- [#364](https://github.com/zzstoatzz/plyr.fm/pull/364) fixed edits that changed only
  SQL and left the public record stale. Later Docket work moved these operations
  back to optimistic SQL followed by background PDS writes. Current task handlers
  log and swallow failures; that can leave an apparently successful SQL comment
  without its canonical record. Next should acknowledge canonical PDS success.
- [#372](https://github.com/zzstoatzz/plyr.fm/pull/372) preserved navigation without
  interrupting playback and made URLs in comment text clickable.
- [#1873](https://github.com/zzstoatzz/plyr.fm/pull/1873) fixed timestamp clicks
  seeking the previous audio source. The intent belongs to a track identity,
  applies after that source attaches, wins over restored progress, and is cleared
  on a different source or access denial. Existing regression tests cover this.
- [#1968–#1980](https://github.com/zzstoatzz/plyr.fm/pull/1980) developed passing
  comments: only real forward timestamp crossings emit; initial ticks, seeks,
  backward movement and jumps over three seconds do not spray missed comments.
  Zero-position comments do not emit. Stacks last four seconds, cap at three,
  avoid fixed chrome, and respect reduced motion. The final motion is one quiet
  icon pulse and small fade, not rings or bouncing bubbles.

## Smallest proper port

1. Add an optional public `allowComments` boolean to the owner-controlled artist
   profile record, default false when absent. Project it from verified repository
   operations and snapshots. The artist changes it directly on their PDS using
   the existing profile scope. Disabling hides comments immediately at read time;
   it never authorizes deleting another author's canonical records. This is a
   proposed public policy field and needs contract review before implementation.
2. Add the environment-aware comment collection to verified ingestion, repair,
   deletion handling and `awaitRecord`. Persist record URI/CID, author DID, subject
   URI/CID, text, media timestamp and original/update times in a rebuildable
   projection. Replayed creates/updates must converge by canonical record URI;
   missing subjects remain unresolved and reconcile when the track arrives.
3. Expose a bounded read-only comments endpoint and comment count, with the same
   track access policy, explicit enabled/disabled state, author profiles and
   stable `(timestampMs, createdAt, URI)` ordering. Apply artist policy and operator
   moderation on reads, including after an artist disables the feature. Never
   return private-track comments from a public appview route.
4. Add the comment OAuth grant to client metadata/scopes; existing sessions need
   an honest additional-consent path. Client CRUD writes only the author's PDS,
   retains a stable rkey and operation payload across ambiguous network retries,
   checks the same record after a lost response, and guards edit/delete with the
   current CID. Edits preserve the original subject, timestamp and creation time.
   Distinguish PDS success from indexing pending/rejected via `awaitRecord`; do not
   show a failed canonical write as a published comment.
5. Add the real drawer, author actions, login return intent, links and track-bound
   timestamp seek together with the read/write contract. Passing-comment layout
   follows later in the same feature cycle, reusing the existing placement logic
   and motion rules rather than replacing it with a generic toast.

Two policy choices remain explicit. The legacy 20-comment write cap cannot be
globally enforced by a read-only appview over arbitrary PDS writes; decide whether
to present a deterministic bounded subset or replace that product limit. Also,
track edits/audio replacement retain the URI but change the CID. Preserve each
comment's original strong reference and define how verified historical revisions
remain displayed; blindly requiring today's CID would erase existing comments
on an ordinary edit, while silently rewriting their subject loses their meaning.

Next currently has none of the comment record grant, verified projection,
`awaitRecord` support, public opt-in policy, read API, direct CRUD or drawer.
The existing moderation service is reusable groundwork, not evidence that these
missing pieces have already been ported.
