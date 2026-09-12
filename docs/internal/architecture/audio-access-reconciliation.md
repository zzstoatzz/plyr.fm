# audio access reconciliation

Reviewed 2026-09-11 against `00266df4` (PR #2047) and the current upstream
[Spaces proposal](https://github.com/bluesky-social/proposals/blob/main/0016-permissioned-data/README.md).
This is a code-path audit and proposed contract, not a production bucket inventory
or evidence that the proposed changes have shipped.

## product promises

Three questions must remain independent:

1. Who can discover the track and listen?
2. Who can obtain a download through the artist's chosen distribution service?
3. Which host holds each audio object, and what authority permits its retrieval?

Public listening with downloads off, public listening with purchaser downloads,
and access-list-only listening are different promises. A private storage bucket
is not a private audience. A supporter is not necessarily a purchaser of a
particular track. Copyright metadata is not itself a playback entitlement.

The first two PR iterations conflated these concerns: first by substituting a
public-listening mode for private visibility, then by adding a download boolean
that competed with the existing artist policy and reused a listener-access gate
as a storage selector. Neither should become the long-term contract.

## storage inventory

| Objects / location | Writers and lifetime | Readers / important constraint |
| --- | --- | --- |
| R2 private multipart staging (`StagedUploadKey`) | `upload_sessions.py`, `uploads.py`, `storage/r2.py`; finish promotes bytes and removes staging | upload worker only; staging privacy is not the published track policy |
| R2 public audio bucket | ordinary uploads, public transcodes, PDS mirrors; content-hash keys and immutable CDN caching | public audio redirects, public downloads, offline `/url`, exports; changing an app policy cannot revoke already-public bytes |
| R2 private audio bucket | gated uploads/transcodes/replacements and public-to-private moves | presigned audio URLs; these are shareable until expiry, unlike Space credentials |
| Public PDS blobs | upload publish, optimization, explicit PDS saves; public track records reference `audioBlob` | public `com.atproto.sync.getBlob`; R2 may coexist (`audio_storage=both`) or have been removed (`pds`) |
| Permissioned PDS blobs and records | Spaces upload path; authority and writer/repo host resolved separately | `_handle_private_audio` uses the requesting reader's Space credential; do not serve using the artist's authority on behalf of an unauthorized listener |
| Original masters and playback renditions | upload/optimization records `original_file_id/type` separately from `file_id/type` | `/audio/{id}` and `/url` accept original IDs too; “no downloads” does not currently separate a purchasable master from playable bytes |
| Retained audio revisions | `audio_replace.py`, `revisions.py`; snapshots include `was_gated` and PDS location | revision URLs and restores depend on the snapshot's storage boundary; cross-boundary restores are refused |
| Album ZIPs and artist exports | `_internal/export_tasks.py` writes `exports/...` into public audio bucket; temporary local files during assembly | API authorization does not protect the resulting public object URL |
| PDS-ingested / mirrored audio | `_internal/tasks/ingest.py`, `tasks/pds_mirror.py`; blob/URL validation and mirror policy | cannot infer R2 ownership from a file ID or arbitrary URL; `download_key` already distinguishes these cases |

Images use a separate public bucket; changing audio storage does not make artwork
or public track metadata private. Worker/transcoder temporary files are processing
copies, not an additional artist-facing access mode. Existing public caches,
third-party copies, and blobs on other hosts cannot be recalled by a local toggle.

## current gate inventory

| Mechanism | Playback / discovery | Downloads |
| --- | --- | --- |
| `visibility=public/unlisted` | public listening; unlisted is excluded from feeds but remains reachable through profile/search/lists | artist policy and moderation decide |
| `visibility=supporters`, `support_gate.type=any` | owner or `validate_supporter`; existence is public, denied listening returns 401/402 | refused even for supporters |
| `support_gate.type=copyright` | authenticated listening; usually public/unlisted metadata; private R2 | refused; rights writes/removal also change storage and public records |
| `visibility=private`, `space_uri` | Space authority decides access; hidden with 404 outside the list; reader credential used for bytes | currently refused even for owner/members |
| artist `download_policy` | no effect on playback or storage | `open`, `ask`, `supporters`, `off`; unset chooses ask with a support link and open otherwise; ask is a nudge, not authorization |
| PR `allow_downloads=false`, gate type `stream` | anonymous playback but some callers still interpret any gate as restricted listening | refuses everyone before artist policy or supporter standing is considered |
| moderation and sensitive-content preferences | discovery, shared radio, and personal playback have distinct restrictions | copyright labels can refuse downloads; operator allow override is separate from creator rights metadata |

Primary policy owners: `_internal/track_visibility.py`, `_internal/private_access.py`,
`api/audio.py:_check_gate_access`, `utilities/downloads.py:download_refusal`,
`_internal/supporters.py`, and `schemas.py:TrackResponse.from_track`.

## concrete inconsistencies

1. **Storage and listening are coupled.** `support_gate is not None` chooses
   the private bucket, disables public PDS saves, excludes radio and Subsonic,
   and unconditionally refuses downloads. A public stream gate therefore
   creates exceptions throughout the app instead of reconciling its policies.
2. **The checkbox has competing authority.** False overrides every artist
   download tier; true still permits the artist tier to refuse. The UI does not
   explain that precedence. A track-level policy should reuse the existing
   policy vocabulary with explicit inheritance, not add another independent veto.
3. **Master retrieval is not purchaser-only.** Both public audio routes resolve
   original IDs and apply the playback gate. The proposed stream gate admits
   everyone there. Download-endpoint refusal is not a master-file boundary.
4. **Artist recovery is incomplete.** `process_export` queries all artist tracks
   but fetches from the public bucket only, then packages successful fetches.
   Private R2 and PDS-only originals are not covered. Earlier claims that the
   portal already retrieves every protected original were too broad.
5. **Protected album downloads produce public artifacts.** The album endpoint
   checks supporter policy, but the ZIP worker and cached redirect use public R2.
   Neither later policy changes nor the endpoint gate revoke a copied ZIP URL.
6. **Transitions are not a complete object migration.** `move_track_audio`
   moves the current file only, not all originals/revisions/PDS copies. Its
   private-direction success and failure both return None, yet the caller clears
   `r2_url`. Artist preference writes perform no migration at all. Replacement
   rollback still has a public-bucket-only original cleanup branch. These paths
   need explicit tests before expanding protected-storage behavior to them.
7. **Audio identity is shared.** Audio endpoints choose among tracks by file ID,
   preferring a public R2 row. Reuploading the same bytes under a restrictive
   policy cannot make an existing public copy private. Object ownership and
   track policy must not be inferred from one another.
8. **Documentation has drifted.** Some model/docs comments still say Spaces is
   owner-only or describe older capability probing. Executable access uses the
   reader's credential and the authority's member-list decision. The new design
   must follow those owners rather than copy stale prose.

These are code-review findings, not claims of observed production disclosure.
The broader audit has not modified any artist's media, policy, or Space.

## a contract compatible with native Spaces

The upstream proposal evaluates the requesting user and client application
separately. A Space credential admits reads across a Space; it is not a
“stream but never save” credential. The authority owns that decision. The
proposal remains a draft, so wire details stay isolated in the existing Spaces
client rather than becoming a new application-wide permission framework.

- Keep Space identity, authority, repo host, and credential checks intact. A local
  supporter/payment result cannot bypass a Space refusal.
- Preserve the artist's explicit publication choice across host migrations.
  Detecting Spaces support must not publish private tracks, add public members,
  or silently convert public listening into access-list-only listening.
- A service explicitly authorized by an artist to publish playback from a
  protected source is a separate product contract from accessing the artist's
  private-track Space. Do not reuse the owner's credential to bypass the latter.
- Treat private R2 as an application-managed source, not a simulated Space.
  A future Space-backed source can replace it only with compatible authority
  and consent; no fake membership list or invented Space URI is needed today.
- Reuse the existing download policy and entitlement verifier. Any track override
  should inherit by default and use the same policy values. Purchaser access
  needs a verified track/product entitlement, not a renamed supporter boolean.
- Represent object location independently of listening authorization, covering
  original, rendition, revision and ZIP. This does not require a new service.

## bounded revision of PR #2047

The current implementation is not ready to merge. Its green tests prove the
implemented shortcut, not the desired product contract.

1. Replace the extra download boolean/stream support gate with an explicit
   policy resolution that reuses the artist defaults. Keep current visibility
   semantics and Spaces behavior. Preserve legacy copyright behavior until an
   explicit migration is designed; attaching/removing rights must not silently
   widen the audience in the new path.
2. Separate source location from playback gating in the existing model/storage
   owners. Retain compatibility for existing rows; do not migrate already-public
   catalogs as a side effect of an artist preference edit.
3. Route new protected uploads, transcodes, replacements, original recovery and
   downloads through that distinction. Keep authorized ZIPs private. Public
   playback eligibility must not be inferred from a private bucket.
4. Use the same resolved policy in track responses, download endpoints, album
   jobs and upload/edit UI. Public playback should work in radio/embeds and
   Subsonic stream; Subsonic download must honor download policy independently.
5. Verify public/unlisted/Space/supporter/copyright cases, artist/member/outsider
   viewers, inherited/explicit download policy, master vs rendition vs revision,
   policy changes during asynchronous jobs, failed moves and PDS-only sources.

This is a correction within existing policy and storage owners, not a generic
permissions service or a replacement for Spaces. Per-track purchase integration
remains a separately verified entitlement capability; do not advertise it as
complete while implementing only the no-download case.
