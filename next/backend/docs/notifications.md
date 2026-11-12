# notifications

Next serves an account's notifications as three XRPC methods on the API
(`api.next.plyr.fm`), shaped like Grain's and Bluesky's so a notification
client such as noti treats plyr as one more source with no special cases.

| method | kind | does |
|---|---|---|
| `{ns}.notification.listNotifications` | query | newest first, `limit` 1–100 (default 50), keyset `cursor`, plus the account's `seenAt` |
| `{ns}.notification.getUnreadCount` | query | `{count}` after `seenAt` |
| `{ns}.notification.updateSeen` | procedure | `{seenAt}` advances the read watermark |

`{ns}` is the record namespace (`fm.plyr` on Next, `fm.plyr.dev` locally),
the same rule as `{ns}.upload.authorize`. Lexicons are in
[`lexicons/notification/`](../lexicons/notification/).

## what counts as a notification

A notification is a read over the verified projection, not a stored row:

- `like`: another account's live like whose subject is one of your live tracks.
- `feature`: another account's live, public track that lists you in `features`.

Self-likes and self-features are skipped, as are authors whose accounts are
not currently available. Deleting the like or the track removes the
notification; there is nothing to clean up. Each notification is ordered by
its record's `createdAt`, clamped to when plyr indexed it so a future-dated
record cannot pin itself on top. Neither value changes when a repository is
re-verified or the projection is rebuilt, so read state survives both.

The only owned state is `plyr_account.notification_seen`: one watermark per
account (migration 0039). `updateSeen` never moves it backwards (two devices
can race) and never past the server clock. `isRead` is `indexedAt <= seenAt`.

## auth

Like Tangled's and Grain's notification services, there is no plyr session:
the caller presents a service JWT its own PDS signed
(`com.atproto.server.getServiceAuth`), with

- `aud`: the API's service DID (`SPACE_SERVICE_DID`, e.g.
  `did:web:api.next.plyr.fm`) or that DID with `#plyr_appview`, which the
  did:web document now publishes, so a PDS can also proxy the call
  (`atproto-proxy: did:web:api.next.plyr.fm#plyr_appview`);
- `lxm`: the exact method being called;
- `exp` at most five minutes out.

The issuer DID is the recipient. The signature is checked against its current
`#atproto` key, through the same verifier the managed-space
`checkUserAccess` uses (`src/internal/atproto/service_auth.zig`). OAuth
clients request `rpc:fm.plyr.notification.listNotifications?aud=*` (and the
same for the other two).

The methods exist only when `SPACE_SERVICE_DID` is configured.

## noti

The contract is Grain's (cursor, `seenAt`, `updateSeen({seenAt})`), so noti's
existing `notificationService` and `unreadNotificationPages` helpers drive it
unchanged, with read mode `cutoff`:

```ts
// src/plyr.ts
const PLYR_LIST_NOTIFICATIONS = 'fm.plyr.notification.listNotifications'
const PLYR_UPDATE_SEEN = 'fm.plyr.notification.updateSeen'
const service = {origin: 'https://api.next.plyr.fm', audience: 'did:web:api.next.plyr.fm', label: 'plyr'}

export async function listPlyrNotifications(session: AtprotoAccountSession) {
  const client = notificationService(session.agent, service)
  return unreadNotificationPages(async cursor => {
    const query = new URLSearchParams({limit: '100'})
    if (cursor) query.set('cursor', cursor)
    const page = plyrPage.parse(await (await client.list(PLYR_LIST_NOTIFICATIONS, query)).json())
    return {items: plyrInboxItems(page), cursor: page.cursor, readThrough: page.seenAt}
  })
}

export async function markPlyrNotificationsRead(session: AtprotoAccountSession, seenAt: string) {
  await notificationService(session.agent, service).markRead(PLYR_UPDATE_SEEN, seenAt)
}

// one row: nativeId = uri, kind = reason, occurredAt = indexedAt,
// sourceRead = isRead, groupingKey = reasonSubject, subjectTitle = subject.title,
// actor from author (handle is optional), href = the track page
```

and the registry entry mirrors Grain's (`completeness: 'snapshot'`,
`read: {mode: 'cutoff', ...}`). For push-fast delivery, the spacedust sources
are `fm.plyr.like:subject.uri` and `fm.plyr.track:features[].did`.

## not yet

- playlist adds: list members carry no per-item time, so "added your track"
  has no honest timestamp yet.
- comments: Next does not project comments.
- moderation: labelled authors are not filtered here yet.
- the issuer's DID document is resolved per request; cache it if polling
  volume grows.
