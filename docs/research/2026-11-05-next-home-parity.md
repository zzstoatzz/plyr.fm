# Next homepage parity

The production homepage is the reference: lowercase `top tracks`, the default
`past month` chart with period cycling that skips empty periods, horizontal
artwork cards, `artists you know`, and `tracks` / `latest` above the tagged feed.
The Next implementation lives in `next/app/src/Home.tsx`.

Discovery reads stay independent. The chart, latest feed, tag catalog and public
follow graph start separately; a slow follow graph cannot block tracks. Selected
tags are repeated OR filters on the paginated appview query, never a client filter
of the first page. Changing tags starts a new feed generation and discards stale
responses. Selected tags are device preferences keyed by DID, with a separate
anonymous key; this does not extend the private Spaces preference schema.

The browser reads the public Bluesky `app.bsky.graph.getFollows` endpoint, follows
its cursor, and preserves production's oldest-follow-first ordering. Traversal
has a 30-second deadline and a 100-page ceiling. Incomplete results are errors,
not a completed graph. The appview resolves followed DIDs in batches of at most
500 with two concurrent reads. The full operation has a 60-second deadline.
Only complete artist results enter a five-minute per-DID cache, bounded to four
accounts. Account changes abort outstanding work and hide the previous account's
results immediately. Public follow avatars take precedence over appview avatars.

The appview must provide the new tag catalog, filter-bound track cursors and
bounded public artist-resolution read. Its tag projection requires independently
verified records; the UI must not claim filtered-feed parity before that work and
reconciliation are complete. For-you ranking and hidden tag preferences remain
outside this change.

## Verification

`bun run check`, the Node tests and `bun run build:web` pass. Tests exercise
multi-page public follows, failed/repeated pagination, bounded concurrent artist
resolution, original follow ordering, account cancellation, period cycling and
account-isolated tag persistence.

Chromium rendered the built Next assets at 390 and 1280 pixels in light and dark
with Comic Sans. Actual public catalog/chart reads populated the page. The tag
catalog was an explicit HTTP fixture because its API is not deployed yet; selecting
a tag sent a server query and clearing it reset the query. No horizontal page
overflow or browser exceptions appeared. Screenshots were inspected, including
long titles, missing artwork and overflowing horizontal card strips.

A separate browser signed into a disposable local Spaces PDS through real client
OAuth, returned to Home, fetched its public follows and rendered the network
artist cards. The public follow and artist-resolution HTTP responses were explicit
fixtures for this layout check: one read each, long artist name truncated inside
its card, no page overflow. This does not verify production graph intersection.

Run the repeatable anonymous layout/query check with:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright HOME_DIST=/path/to/next/app/dist \
  HOME_TAG_FIXTURE=1 node next/app/scripts/check-home.cjs
```

Omit `HOME_DIST` and `HOME_TAG_FIXTURE` after deployment to check live assets and
the real tag catalog. The script writes screenshots and a report to a unique
`/tmp/plyr-home-*` directory, or `HOME_OUTPUT` when supplied. Its explicit tag
fixture covers only the catalog response, never synthesizes filtered track reads.
