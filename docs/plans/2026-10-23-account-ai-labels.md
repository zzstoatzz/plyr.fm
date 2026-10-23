# plan: account-level ai labels

**date**: 2026-10-23

## goal

let plyr.fm's labeler say "this account publishes AI-generated audio" once,
about the account, and have every surface that already honors the `ai` tag
honor that label the same way. no track record is touched and no tag is
invented.

## why an account label, not a list or a tag

the case is penny.hailey.at, an AI agent. her recent records carry
`"tags": ["ai"]` and are already hidden from discovery. her older records
carry no tags, and a few new ones still slip through (one has an explicit
`"tags": []`). on 2026-10-22, 16 of the top 50 tracks in production's latest
feed were hers. her Bluesky profile has no labels. an agent that wants to
disclose still misses some records, and accounts that don't want to disclose
won't do it at all.

three ways to express "treat this account's audio as ai":

- **write `ai` into their records.** a write to someone else's PDS. never.
- **inject `ai` tags into our index, or keep a private DID list.** since #2201
  the PDS is the authority for tags, so a fabricated index tag contradicts the
  record and reconciliation would fight it. a private list is invisible to the
  account, unappealable, and no other app can read it.
- **a signed label whose subject is the account DID.** the label spec already
  allows this: a label's `uri` is "AT URI of the record, repository (account),
  or other resource". it is public through `queryLabels` and
  `subscribeLabels`, recorded in the moderation event log, and reversible by
  negation. this matches label-policy.md: the label is a portable assertion,
  and what plyr does with it is local hosting policy.

the third is the plan.

## current state

- **labeler** (`services/moderation`): `/emit-label` takes any `uri` string, so
  a bare DID is already a valid subject on the wire. the labeler service record
  (`did:plc:xnk7t5cvnnvzkmbf7wpss527`) declares `copyright-violation`,
  `sexual`, `porn`, and no `subjectTypes` restriction. one labeler serves both
  staging and production.
- **admin UI**: `extract_namespace` in `admin.rs` derives the environment
  badge from `at://did/fm.plyr[.env].track/rkey`. a bare DID has no
  collection, so it would render as `unknown`.
- **projection**: `sync_operator_labels` (`_internal/tasks/labels.py`, every
  5 min) asks `/internal/labels-by-value` for `PROJECTED_LABEL_VALUES` and
  writes `tracks.operator_labels`, matching on `Track.atproto_record_uri`.
  `_internal/label_stream.py` re-runs the same sync on every label commit, so
  extending the sync covers both freshness paths.
- **hidden-tag enforcement** happens in exactly three places:
  `tracks/listing.py` `list_tracks` (discovery only; artist pages are not
  filtered), `for_you.py`, and `radio/stations.py` (`_has_hidden_tag`, which
  uses the default list for everyone and feeds the slop station). search,
  albums, playlists, and Subsonic do not filter hidden tags.
- **event log**: `moderation_events.subject_uri` is free text; nothing
  rejects a DID.
- **transparency**: `_internal/transparency.py` renders `label_applied` as
  "labeled a track" and never names the uploader.

## decisions

defaults chosen here. reject any of them in review.

- **value `ai`.** the same word as the tag, so one listener preference covers
  both. a listener whose `hidden_tags` contains `ai` hides labeled accounts;
  removing `ai` shows them. there is no separate toggle.
- **parity with the tag.** a labeled account's tracks go exactly where `ai`
  tagged tracks go: hidden from latest and for you by default, aired only on
  slop, shown on artist pages and in search. no owner exemption beyond what
  tags have.
- **account labels are environment-free.** a DID is the same identity in
  staging and production, and the claim is true in both. staging tests use a
  throwaway test DID, never a real account.
- **transparency posts say "labeled an account"** with the value and reason,
  and no profile link, which keeps "never names the uploader".
- **declared for Bluesky subscribers too.** `ai` gets a
  `labelValueDefinition` with severity `inform` and blurs `none`: anyone
  subscribed to plyr's labeler sees it on the account, nothing is hidden or
  blurred.
- **operator-applied only.** no automatic classifier emits it.

## not doing

- **self-labels.** compliant agents already have a path: the `ai` tag. an
  account-level self-label would be new lexicon surface (`fm.plyr` profile or
  Bluesky profile self-labels) and is its own decision.
- **reading third-party labelers.** trusting another labeler's account labels
  is a trust-a-DID question, not this change.
- **per-artist cap on latest.** addline.selfhosted.social fills the latest
  feed with non-AI mixes, so volume is a separate problem with a separate fix.
  `for_you.py` already has `_diversify_by_artist`; reusing it for latest is its
  own PR.
- **a moderation dashboard UI for accounts.** phase 1 uses a script; a UI
  waits for a second account.
- **search filtering.** tags don't filter search either; changing that applies
  to both and is separate.

## phases

### phase 1: label accounts and project the label

**changes**:
- `backend/src/backend/_internal/content_labels.py`: add
  `ACCOUNT_LABEL_VALUES = frozenset({"ai"})`, kept apart from
  `PROJECTED_LABEL_VALUES` because those are matched against track URIs.
- `backend/src/backend/models/artist.py` plus a migration
  (`just backend migrate "artist operator labels"`): add
  `artists.operator_labels` JSONB, not null, default `[]`.
- `backend/src/backend/_internal/tasks/labels.py`: request
  `PROJECTED_LABEL_VALUES | ACCOUNT_LABEL_VALUES` in one call, route subjects
  that are bare DIDs (`did:` prefix) to `artists.operator_labels` and the rest
  to tracks as today. a negation clears the artist. a labeler outage still
  raises before writing anything.
- `scripts/label_account.py`: `--handle` or `--did`, `--reason` (required),
  `--actor` (required), `--negate`, `--dry-run`. resolves the handle, calls
  `emit_label(uri=did, val="ai")`, then `record_event(subject_uri=did,
  action="label_applied" | "label_negated", ...)`. prints the resulting
  `queryLabels` row.
- `services/moderation/src/admin.rs`: `extract_namespace` returns `None` for a
  bare DID and the card renders an "account" badge rather than `unknown`.

**success criteria**:
- [ ] tests pass: `just backend test` and `cargo test` in `services/moderation`
- [ ] a bare-DID label projects onto `artists.operator_labels` within one
      sync, and a negation clears it
- [ ] a track-URI label still projects onto tracks, nothing more
- [ ] a labeler error leaves both projections unchanged

### phase 2: honor it wherever the tag is honored

**changes**:
- `backend/src/backend/utilities/tags.py`: one helper that answers "is this
  track hidden for these hidden tags" from the track's tags plus its artist's
  `operator_labels`, and a SQL form of it, so the three sites cannot drift.
- `backend/src/backend/api/tracks/listing.py`: in the discovery branch, extend
  the hidden filter to `Artist.operator_labels ?| hidden_tags` (`Artist` is
  already joined). artist-scoped queries stay unfiltered.
- `backend/src/backend/api/for_you.py`: drop tracks whose artist's labels
  intersect `hidden_tags`, next to the existing tag drop.
- `backend/src/backend/api/radio/stations.py`: `_has_hidden_tag` takes the
  track and also checks `track.artist.operator_labels`, so the default
  stations exclude labeled accounts and slop includes them.
- `docs/internal/moderation/label-policy.md`: add the account family to the
  "who decides" table (listener decides, through `hidden_tags`) and the
  filtering-sites table.

**success criteria**:
- [ ] anonymous latest feed excludes a labeled account's untagged track
- [ ] a signed-in listener with `ai` removed from `hidden_tags` sees it
- [ ] the artist page lists every track either way
- [ ] cursor pagination over latest still returns full pages (`has_more`
      stays correct)
- [ ] slop airs the track and the other stations do not

### phase 3: declare it and show it

**changes**:
- declare `ai` on `app.bsky.labeler.service/self` using the runbook procedure
  in `docs/internal/runbooks/moderating-sensitive-audio.md` (`swapRecord`,
  `MODERATION_BSKY_PASSWORD`): name "ai-generated audio", description "this
  account publishes AI-generated audio", severity `inform`, blurs `none`,
  `adultOnly` false. update that runbook's list of declared values.
- `backend/src/backend/_internal/transparency.py`: render a DID-subject
  `label_applied` / `label_negated` as "labeled an account" / "withdrew a
  label from an account", with no link.
- `backend/src/backend/api/artists.py` `ArtistResponse`: add `labels:
  list[str]` from `operator_labels`.
- frontend artist page (`frontend/src/routes/u/[handle]/+page.svelte`): a
  small "ai-generated audio" note under the name, with a link to
  `docs/public/artists.md#ai-generated-audio`, so the account and its
  listeners can see why its tracks are missing from latest.
- `docs/public/moderation.md`: a short paragraph saying plyr may label an
  account that publishes AI-generated audio without tagging it, what that
  does, and how to ask for review.

**success criteria**:
- [ ] `app.bsky.labeler.getServices` lists `ai` with its definition
- [ ] a rendered transparency post for an account label never names the
      account (checked in disabled-but-logging mode first)
- [ ] the note renders on the artist page at narrow and desktop widths in both
      themes (`ui-check`)

### phase 4: apply it in production

after phases 1–3 are on production: dry-run, then label penny.hailey.at with a
reason pointing at her own bio ("ai agent on atproto"), and read
`queryLabels` back. confirm the latest feed no longer shows her untagged
tracks, and confirm her artist page still lists all of them.

## testing

- sync: a DID-subject label and a URI-subject label in the same response go to
  the right tables; negating one leaves the other.
- listing: anonymous, signed-in default, and signed-in with `ai` unhidden;
  artist-scoped stays unfiltered; a labeled account that also tags a track is
  hidden once, not double-counted.
- for you and radio: the same three viewers where a viewer exists; radio has
  no viewer and uses defaults.
- the regression the plan guards against: test against the real endpoints
  with only the labeler HTTP boundary mocked, and show the listing test fails
  before phase 2.
