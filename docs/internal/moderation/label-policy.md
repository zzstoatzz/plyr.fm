# label policy

How plyr.fm turns signed labels into behavior. Grounded in the only two label
families we actually have — adult audio and copyright — because a policy
invented ahead of its cases tends to be wrong about both.

## two layers

**The label is a portable assertion.** Signed, published, and queryable by
anyone through `com.atproto.label.queryLabels` and `subscribeLabels`. Any
client reading `fm.plyr.track` can subscribe to our labeler and decide for
itself what to render. We do not get to decide that for them, and should not
try to.

**Enforcement is plyr-local hosting policy.** What *we* do on *our* surfaces
with *our* storage. Keyed off the label, but not the same thing as the label,
and not binding on anyone else.

Conflating these is what produced the previous state, where "we labeled it"
and "we did something about it" were assumed to be one step and turned out to
be zero.

## the two families differ in who decides

| | adult (`sexual`, `porn`) | copyright (`copyright-violation`) |
|---|---|---|
| what it asserts | this is adult content | someone claims this infringes |
| who decides on rendering | **the listener** | **us** |
| listener preference | `show_sensitive_audio` opts in | none — no preference can answer it |
| feeds, search, collections | hidden unless opted in or owner | hidden for everyone |
| radio | never | never |
| owner's own library | always visible | always visible |
| audio bytes / permalink | **plays** | **plays** |
| takedown | n/a | deliberate human step, never automatic |

**Adult is a rendering default.** A listener may override it for themselves.
This is the case that genuinely defers to the reader.

**Copyright is a hosting obligation.** We serve the bytes from our own R2, so
the duty to act on knowledge is ours and no reader preference discharges it.
De-listing is the cheap, reversible action that discharges it; takedown is not
automatic because a fingerprint match is not a finding — a cover the uploader
performed matches, and so does a remix they made.

## why neither gates the bytes

Adult labels used to return `401` for anonymous listeners at the audio
endpoint. That looked like age verification and was not: **any** account
satisfied it, and plyr verifies nobody's age. What it reliably did was break a
creator sharing a direct link to their own work with someone signed out. The
gate cost creators real utility and bought the appearance of a safeguard.

Copyright does not gate bytes either, for a different reason: de-listing is
automatic and reversible, but making an uploader's permalink dead on an
automated fingerprint match is neither.

Removing the gate also deleted a strict labeler read — and its `503` failure
mode — from every audio request.

## context: where a track is being rendered

Filtering depends on *where* a track appears, not only what it carries.
`LabelContext.LIST` is a surface we chose to put in front of someone — feeds,
search, radio, recommendations. `LabelContext.VIEW` is a page they navigated
to: an artist's catalogue, a collection.

this mirrors ATProto's own moderation contexts. From the
[moderation API docs](https://github.com/bluesky-social/atproto/blob/main/packages/api/docs/moderation.md):

> a post might be blurred in a feed (`contentList`) but fully visible when
> opened directly (`contentView`)

Bluesky's client makes that call per render, because its server ships labels
and `moderateProfile(x, opts)` returns `filter` / `blur` / `alert` / `inform`
for the UI to apply. We make it per query instead, because our filtering has to
live in SQL to compose with cursor pagination (#1676). Same distinction,
different layer — worth knowing when reading their code, since the shape does
not transfer directly.

**the deciding argument was local, though.** `list_tracks` had *already* made
this call for visibility: an artist-scoped query lists unlisted tracks,
excluding only private ones, because an artist page shows their catalogue.
Labels were the outlier in a function that had settled the question six lines
earlier.

### every filtering site, and its context

verified against the code; if you change one, change this table.

| call site | context |
|---|---|
| `tracks/listing.py` list_tracks | **VIEW** when `artist_did`, else LIST |
| `tracks/listing.py` top tracks | LIST |
| `search.py` keyword + semantic | LIST |
| `for_you.py` | LIST |
| `radio/corpus.py` | excluded outright, both families, no viewer |
| `albums/listing.py` detail | **VIEW** |
| `lists/hydration.py` | **VIEW** |
| `users.py` public likes | **VIEW** |
| `tracks/likes.py` own likes | **VIEW** |
| `_internal/queue.py` | **VIEW** |
| `subsonic/browsing.py` getAlbum | **VIEW** |
| `subsonic/browsing.py` getRandomSongs | LIST |
| `subsonic/endpoints.py` playlist, getSong | **VIEW** |
| `_internal/jams.py` | LIST |
| `tracks/listing.py` list_my_tracks | no label filter at all |

`list_my_tracks` filters on `artist_did` alone, which is why a creator's portal
always shows their whole catalogue.

**jams are LIST on purpose.** A jam is a shared synchronized room like radio.
Its filter is per-viewer, so participants can already see different queues —
a product question worth raising on its own rather than changing silently.

**Subsonic passes `viewer=None`.** A Subsonic client authenticates with a
developer token rather than a session, so there is no preference to read. In a
VIEW context that is fine; `getRandomSongs` is a shuffle feed and stays LIST,
which means adult audio never reaches it.

### the owner exemption

`sensitive_audio_visible_clause` returns `~labeled | (Track.artist_did ==
viewer_did)`, and the app-side filter has the matching `or track.artist_did ==
viewer_did`. So **an owner sees their own adult-labeled tracks in every
context**, regardless of preference.

it is scoped to the adult branch only: an owner does *not* see their own
copyright-labeled track in a LIST surface, because that is a hosting decision
rather than a preference. Radio has no viewer at all, so the exemption cannot
apply there either.

this rule is easy to trip over when testing. A check run as the track's owner
passes whether or not the context split works — verify with an anonymous or
non-owner viewer.

### the rules

adult labels apply only in `LIST`. Filtering an artist's own page made it
misrepresent their catalogue — it rendered "4 tracks" above a list of one —
and disagreed with the album page one level deeper, which showed everything.
Copyright applies in **every** context: a hosting obligation is not discharged
by the listener having already found the artist.

### why this also fixed an authentication problem

the artist page could not know the viewer. Its server load runs on the frontend
host, and the session cookie is host-only on the API origin, so the browser
never delivers it there and there is nothing to forward — `55438aa3` (#284)
tried exactly that in November 2025 and abandoned it, leaving the
`no cookie available on frontend host` comment behind as the conclusion.

widening the cookie to `.plyr.fm` would make forwarding possible and is the
wrong trade: the session would then be sent to `audio.plyr.fm` and
`images.plyr.fm`, which are R2 custom domains, on every artwork and audio
request — session material into a storage service and its logs, and
cookie-bearing requests are the shape most likely to defeat the 1-year edge
cache rule on exactly those assets. Staging subdomains would receive production
sessions too.

not filtering a VIEW context dissolves the problem rather than working around
it: the anonymous server render and the hydrated client render produce the same
list, so there is no divergence to authenticate away. Client-side fetches still
need `credentials: 'include'` for genuinely personalized data such as liked
state — a cross-origin fetch sends no cookies without it, which is why the
album page worked and the artist page did not.

## composing the SQL predicate

`label_visible_clause()` composes both families, the override, and the context,
and every shared surface uses it. An earlier shape skipped the visibility
predicate *entirely* for viewers who had opted into sensitive audio:

```python
if not shows_sensitive_audio:
    stmt = stmt.where(sensitive_audio_visible_clause(viewer))
```

Folding copyright into that predicate without composing it would have leaked
copyright-labeled tracks to exactly the viewers who opted into sensitive
audio. A regression test pins this.

Filtering stays in SQL so it composes with cursor pagination — app-side
filtering broke `has_more` in #1676.

## freshness

`tracks.operator_labels` is the projection the SQL filters read, reconciled by
`sync_operator_labels` every five minutes. The `subscribeLabels` consumer
(`_internal/label_stream.py`) refreshes it as labels commit, so a copyright
label de-lists in seconds rather than minutes — five minutes is a long time to
keep broadcasting an asserted infringement on radio. The perpetual sync remains
the backstop; if the stream refresh fails it is logged and dropped.

## history

The asymmetry this document resolves was not drift. The 2026-01-02 legal review
concluded that public "potential violation" labels we have not acted on create
knowledge without action:

> safe harbor requires action when you have knowledge — public labels =
> knowledge. either don't flag it, or flag it and act on it.

`df0c0dae` (#703) did the first half — it stopped auto-emitting labels — and
deferred the second with "for future use when we build the notification +
action pipeline." That pipeline was not built, and ten already-published labels
were never retracted, so the exact configuration the review warned about stayed
live for roughly seven months. They were retracted on 2026-07-25; see
`copyright-worklist-2026-07-25.md`.

Adult enforcement was built separately in July (#1676–#1683) during a live
incident, end-to-end, because it had to work that day. Two systems built under
opposite pressures, never reconciled until now.

## deliberately not done

**No automatic uploader notification.** Building a notification pipeline and
pointing it at a backlog would DM people about flags from December. Any
notification must fire on new events only, never on backfill.

**No per-track override yet.** Today the only lever against a false positive is
negating the label, which conflates "this assertion is wrong" with "this
assertion is right and I am allowing it anyway." Those are different statements
and the second one has nowhere to live. That needs a moderation event log —
subject, actor, action, reason, timestamp — which is the next piece of work.
