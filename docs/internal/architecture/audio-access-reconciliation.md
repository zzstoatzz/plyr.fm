# audio storage and access

Visibility, download permission, and object location answer different questions.
Public listening with downloads off is not a private audience. A Space remains
private to the readers its authority admits, regardless of download settings or
supporter standing.

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
| original masters | upload / optimization | same private bucket as protected rendition; artist recovery permitted |
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
A future artist-authorized service publishing playback from a Space needs that
distinct authorization; it must not borrow the private-track owner's credential
to bypass a listener's refusal.

Legacy public-to-gated moves are not complete catalog migrations: they cannot
revoke public originals, historical PDS blobs or third-party caches. This upload
feature performs no such migration and makes no such promise. New protected
audio stays private through optimization, replacement, revisions and ZIP creation.
