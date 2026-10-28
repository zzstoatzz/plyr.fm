# audio storage and access

The protected PDS source path described here is live on staging as of October 28,
2026, with production promotion still pending. Existing catalog audio is unchanged.
See [protected PDS audio](protected-pds-audio.md) for the implementation contract
and the [delivery plan](../plans/2026-10-28-protected-pds-audio.md) for validation.

Visibility, download permission, and source location answer different questions.
Public listening with downloads off does not create a private audience. The
artist's `self` Space protects member-private metadata and audio; their separate
`playback` Space permits public reads only through an authorized app. Anonymous
listeners and listeners without a Spaces PDS can use that app's playback route.

## decision history reviewed for #2047

These are decisions recorded in merged PRs, not inferred from today's field names.

| Date | Decision | Consequence here |
| --- | --- | --- |
| 2025-12-23, [#637](https://github.com/zzstoatzz/plyr.fm/pull/637) | Supporter playback introduced private R2 and signed serving. Toggling the listener gate moved the rendition between buckets. | Legacy gated rows remain private R2; newer protected sources may live in Spaces. |
| 2026-01-29, [#823](https://github.com/zzstoatzz/plyr.fm/pull/823) | Public uploads gained PDS blobs for ownership, with R2 for CDN performance. Gated audio was excluded from public PDS saves. | Both bulk and single-track saves must also exclude protected sources without listener gates. |
| 2026-05-14, [#1402](https://github.com/zzstoatzz/plyr.fm/pull/1402) | Copyright reused private R2 and `support_gate`, admitting authenticated listeners. That reuse was deliberate because the storage paths matched. | Preserve copyright's authenticated audience. Public listening needs a source marker rather than another gate type. |
| 2026-06-08, [#1557](https://github.com/zzstoatzz/plyr.fm/pull/1557) | One visibility axis replaced overlapping booleans. Private media became PDS-native with no R2 upload fallback. | Do not overload `private` or make its meaning depend on PDS capability. |
| 2026-08-14, [#1842](https://github.com/zzstoatzz/plyr.fm/pull/1842) | Download policy became open/ask/supporters/off, with an automatic default and verifier-neutral enforcement. Bytes and album ZIPs remained public; per-track overrides were a stated follow-up. | Reuse those policies and precedence. Private storage for new restricted uploads and private ZIPs are deliberate changes to the old courtesy-only behavior. |
| 2026-08-23, [#1930](https://github.com/zzstoatzz/plyr.fm/pull/1930) | Removed the app's membership mirror. The Space authority answers for each reader, subject to credential lifetime. | Never infer membership from downloads, payments, or artist activity in plyr. |
| 2026-08-26, [#1939](https://github.com/zzstoatzz/plyr.fm/pull/1939) | Supporter verification gained attested.network before its atprotofans fallback. | Download selection cannot require an atprotofans profile; verification remains in `validate_supporter`. |

During the September publishing change, the initial `visibility=stream` proposal and subsequent synthetic
stream gate were discarded. They confused public listening with audience control
and duplicated download policy. The final model adds a source location and a
per-track override to existing contracts, without adding another visibility.

Self-review found and fixed the missed single-track PDS-save guard, public-bucket
assumptions in rendition deletion and revision-original pruning, and the new
atprotofans-only download-selection restriction. Endpoint and pruning regressions
fail on the previous implementation. The older access-list design's comparison
table describes its pre-membership baseline; its later authority section and the
contract below describe the newer staging behavior.

## current staging policies

| Choice | Listening | Downloads through plyr.fm | New audio source |
| --- | --- | --- | --- |
| public / unlisted, open or ask | anyone; unlisted stays out of discovery | open, or support-link prompt | existing public PDS / R2 pipeline |
| public / unlisted, off | anyone | artist recovery only | artist playback Space, or explicitly accepted private R2 on an unsupported PDS |
| public / unlisted, supporters | anyone | artist or verified supporter | same protected source choice |
| signed-in or supporter listening | independently authorized audience | independent download policy | same protected source choice |
| private metadata / Space members | requesting reader's Space credential | no ordinary download route; owner export supported | artist member-private self Space |

The `publishing` template resolves Portal, album and per-track choices. Public
track records carry `downloadPolicy` alongside `audioSpace`, so an index rebuild
recovers the policy. A missing policy on a newly imported protected track defaults
to off; an invalid policy is rejected. Source location does not imply permission.

Capability is `describeServer.spacesAlpha`; OAuth permission is a separate parsed
grant. A capable host requires the artist's playback grant and a successful PDS
write. Refusal or a failed capability probe does not authorize R2-only storage.
Only an unsupported host permits explicit `accept_plyr_storage=true` per upload.
Existing private-R2 sources remain usable. Changing an existing public source to
protected storage requires Spaces; the policy editor does not create new R2-only
sources. No automatic catalog migration occurs.

## storage and lifecycle

`protected_audio` on tracks and revisions identifies the Space record and its
blob references. Public metadata carries only `audioSpace`; protected blobs never
enter public `audioBlob` or `pds_blob_cid`. `space_uri` retains its separate meaning
for member-private metadata. `audio_storage=r2_private` can describe a playback
mirror even when the canonical protected source belongs to the artist's PDS.

Direct protected uploads and replacements write the source to the PDS before
attempting the optional R2 mirror. Resumable uploads still need private R2 staging
for transfer; after assembly they establish PDS ownership before the playback
mirror. Web-playable sources need no mandatory conversion. Deferred optimization
retains the original in the Space and publishes a new protected source record.

Replacement snapshots retain the old pointer. Restore preserves the protected
source and current permissions; unsupported crossings between legacy and protected
PDS storage are rejected. Revision pruning and deletion remove source records
only after no live track or retained revision references them. Remote cleanup
failure can retain an unused source rather than delete shared data.

Ingestion resolves even an unchanged `audioSpace` URI because external clients can
mutate its record. Trusted mirror status survives only unchanged record CID,
playback/original blob references and file identities. Imported content hashes
alone cannot claim another artist's private R2 object.

Processors receive a signed private-mirror URL only after source CID, size and
content hash verification, successful storage, and a conditional database update
that confirms the source did not change during copying. Transient failures queue
bounded retries; deterministic verification refusal does not schedule scans.
Member-private tracks remain excluded from public processing hooks.

Distinct protected originals are authorized against the selected track ID, not
another track sharing its playback hash. Artist exports can stream originals from
the PDS without a playback mirror. Artist and album ZIPs are private artifacts;
their download endpoints recheck the applicable authorization. Public protected
tracks remain usable by radio and Subsonic; downloads follow their own policy.

## authorization bounds

App-authorized reads use the artist's public-read, app-restricted playback Space,
not the private-track owner's delegation. Each protected playback request obtains
or reuses a valid app credential before considering a verified R2 mirror. A
missing mirror streams from the PDS; it does not remove the artist's source.

Credential caching is capped at 50 minutes and, when the JWT has an expiry, ends
30 seconds before that expiry. Issued private R2 URLs default to 3600 seconds.
Changing Space app access therefore takes effect within credential and issued-URL
lifetimes, not instantly. Playback gives listeners bytes: download policy cannot
prevent recording or recall earlier public copies, PDS blobs, exports or caches.
Space capability detection never changes the audience or migrates old sources.
