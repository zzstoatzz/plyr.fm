# audio storage and access

Visibility, download permission, and object location answer different questions.
Public listening with downloads off is not a private audience. A Space remains
private to the readers its authority admits, regardless of download settings or
supporter standing.

## decision history reviewed for #2047

These are decisions recorded in merged PRs, not inferred from today's field names.

| Date | Decision | Consequence here |
| --- | --- | --- |
| 2025-12-23, [#637](https://github.com/zzstoatzz/plyr.fm/pull/637) | Supporter playback introduced private R2 and signed serving. Toggling the listener gate moved the rendition between buckets. | Legacy `support_gate` still implies a private R2 source. |
| 2026-01-29, [#823](https://github.com/zzstoatzz/plyr.fm/pull/823) | Public uploads gained PDS blobs for ownership, with R2 for CDN performance. Gated audio was excluded from public PDS saves. | Both bulk and single-track saves must also exclude protected sources without listener gates. |
| 2026-05-14, [#1402](https://github.com/zzstoatzz/plyr.fm/pull/1402) | Copyright reused private R2 and `support_gate`, admitting authenticated listeners. That reuse was deliberate because the storage paths matched. | Preserve copyright's authenticated audience. Public listening needs a source marker rather than another gate type. |
| 2026-06-08, [#1557](https://github.com/zzstoatzz/plyr.fm/pull/1557) | One visibility axis replaced overlapping booleans. Private media became PDS-native with no R2 upload fallback. | Do not overload `private` or make its meaning depend on PDS capability. |
| 2026-08-14, [#1842](https://github.com/zzstoatzz/plyr.fm/pull/1842) | Download policy became open/ask/supporters/off, with an automatic default and verifier-neutral enforcement. Bytes and album ZIPs remained public; per-track overrides were a stated follow-up. | Reuse those policies and precedence. Private storage for new restricted uploads and private ZIPs are deliberate changes to the old courtesy-only behavior. |
| 2026-08-23, [#1930](https://github.com/zzstoatzz/plyr.fm/pull/1930) | Removed the app's membership mirror. The Space authority answers for each reader, subject to credential lifetime. | Never infer membership from downloads, payments, or artist activity in plyr. |
| 2026-08-26, [#1939](https://github.com/zzstoatzz/plyr.fm/pull/1939) | Supporter verification gained attested.network before its atprotofans fallback. | Download selection cannot require an atprotofans profile; verification remains in `validate_supporter`. |

Within this PR, the initial `visibility=stream` proposal and subsequent synthetic
stream gate were discarded. They confused public listening with audience control
and duplicated download policy. The final model adds a source location and a
per-track override to existing contracts, without adding another visibility.

Self-review found and fixed the missed single-track PDS-save guard, public-bucket
assumptions in rendition deletion and revision-original pruning, and the new
atprotofans-only download-selection restriction. Endpoint and pruning regressions
fail on the previous implementation. The older access-list design's comparison
table describes its pre-membership baseline; its later authority section and the
contract below describe current behavior.

## policies

| Choice | Listening | Downloads through plyr.fm | New audio location |
| --- | --- | --- | --- |
| public / unlisted, open or ask | anyone; unlisted stays out of discovery | open, or a support-link prompt | existing public R2 / PDS pipeline |
| public / unlisted, off | anyone | artist recovery only | private R2 |
| public / unlisted, supporters | anyone | artist or verified supporter | private R2 |
| supporters visibility | owner or verified supporter | artist recovery; existing refusal for listeners | existing private R2 pipeline |
| copyright metadata | authenticated listeners, preserving the rights workflow | artist recovery, subject to moderation | existing private R2 pipeline |
| private visibility | requesting reader's Space credential | owner export through the owner's credential; no public download route | permissioned PDS |

The optional upload `download_policy` reuses `open`, `ask`, `supporters`, and
`off`. Omission inherits the artist preference and its automatic open/ask default.
Explicit overrides live in `Track.extra`; responses, individual downloads and
album downloads use the same precedence. Metadata edits preserve the override.
This PR does not add an existing-track conversion control.

`audio_storage=r2_private` records location independently of permission. Legacy
gated R2 rows remain readable without migration. Artist preference changes affect
eligibility for inheriting tracks, not location. Copyright removal and supporter
gate removal keep explicitly protected R2 sources private. Public playback does
not require a synthetic support gate.

Supporter standing does not prove purchase of a particular track. A purchaser
integration needs a verified product entitlement; this change does not claim to
provide that integration. Playback delivers audio bytes, so this is distribution
control, not DRM. Before optimization the original may also be the playable
rendition. Once a distinct rendition exists, the protected master cannot be
fetched anonymously through either audio route.

## storage and lifecycle

| Objects | Writers | Retrieval / lifetime |
| --- | --- | --- |
| multipart staging | resumable uploads | private staging; promotion selects the destination bucket |
| public R2 audio | ordinary uploads, transcodes, PDS mirrors | existing CDN and download paths |
| private R2 audio | protected/gated uploads, transcodes, replacements | signed playback URLs; original downloads enforce policy |
| public PDS blobs | ordinary uploads and PDS saves | public getBlob; protected sources excluded from public mirroring |
| permissioned PDS audio | Spaces uploads | reader credentials, without an owner-credential fallback for public playback |
| original masters | upload / optimization | same private bucket as protected rendition; artist recovery permitted; revision pruning uses that bucket |
| retained revisions | replacement / restore | was_gated retains its historical bucket meaning; restore checks the boundary and preserves private storage |
| artist ZIPs | export worker | source bucket or PDS, including owner-authorized Space reads; incomplete exports fail; owner endpoint signs private ZIP |
| album ZIPs | album worker | private source reads and ZIP; completion returns the album endpoint to recheck current policy and content before signing |
| ingested records | firehose | public metadata echoes do not turn an existing protected source public |

Public protected tracks remain eligible for radio and Subsonic streaming.
Subsonic downloads enforce the normal download policy independently. Moderation
and classification receive signed private-R2 URLs; these sources are already
application-owned objects and do not need public-PDS mirroring. Native private
tracks retain their exclusion from public hooks.

Artwork and public metadata are separate from audio storage. Worker/transcoder
temporary files are processing copies, not another audience setting. Already
public copies, CDN caches, PDS blobs and old public ZIPs cannot be recalled by a
new setting. A content-hash ID may be shared by public and protected uploads;
the latter cannot make the former private.

## Spaces compatibility and bounds

The [upstream proposal](https://github.com/bluesky-social/proposals/blob/main/0016-permissioned-data/README.md)
evaluates the requesting user and client separately. Space read credentials do
not distinguish playback from saving received bytes. The existing Spaces client
owns those wire details, and authority refusal remains final.

Detecting Spaces support does not migrate sources, publish private tracks or
change audiences. Private R2 is application-managed storage, not a fake Space.
An explicitly requested owner export can create a private R2 ZIP containing Space
audio. That is an additional export artifact, not a playback source or an upload
fallback; it remains behind the owner download endpoint.

A future artist-authorized service publishing playback from a Space needs that
distinct authorization; it must not borrow the private-track owner's credential
to bypass a listener's refusal.

Legacy public-to-gated moves are not complete catalog migrations: they cannot
revoke public originals, historical PDS blobs or third-party caches. This upload
feature performs no such migration and makes no such promise. New protected
audio stays private through optimization, replacement, revisions and ZIP creation.
