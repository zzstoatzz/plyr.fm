# Zig v1 playback resource

`GET /v1/tracks/{track_id}/playback` resolves whether a caller may retrieve a
track and, when possible, supplies one delivery origin. It returns a JSON
capability instead of redirecting so authorization, availability, and integrity
remain observable and testable rather than being encoded into storage URLs.

## response contract

An anonymously playable track returns `200` with:

- the opaque v1 track ID and exact record URI, CID, and repository revision;
- anonymous authorization with status `granted`;
- availability status `available` or `unavailable`;
- the declared artifact, when the signed record identifies one; and
- at most one selected delivery origin with explicit source and integrity.

An unavailable response is still `200`: the catalog record exists and the
caller is allowed to play it, but no acceptable origin is currently known.
Supporter-gated or otherwise gated content returns `401
authentication_required`. Missing, private, operator-excluded, and
copyright-blocked records return `404`, preserving the catalog's non-disclosure
rule. Invalid opaque IDs return `400`; corrupt projection data returns `500`;
and index or pool failure returns `503`.

## authority and selection

The adapter reads verified track records, authoritative account availability,
application policy, moderation, and exact record-CID-bound delivery evidence.
It does not read legacy track or file identifiers and does not treat the legacy
track table as an authority.

Selection is deterministic:

1. Prefer an R2 origin whose bytes were verified against the signed record's
   raw blob CID and whose evidence is bound to the exact record CID.
2. Otherwise, permit the HTTPS URL declared in the signed artist record, but
   label it `source: authored_record` and `integrity: unverified`. The signature
   authenticates the declaration, not the bytes served later by that URL.
3. Otherwise, return an available catalog capability with playback availability
   `unavailable`.

Only credential-free HTTPS URLs with a host and no fragment are exposed. A
verified delivery must match both the record's artifact CID and media type.
Stale evidence for a previous record revision is ineligible.

## deliberate gaps

This first slice is anonymous. Session-aware supporter and copyright grants,
private-space proxying, current-PDS `getBlob` resolution, and play-count commands
remain separate work. Historical R2 objects need a CID-verifying backfill before
they can become verified origins; until then, compatible signed-record URLs are
usable only with explicit unverified integrity.

Clients migrate by using the opaque track ID already returned by v1 catalog
reads, fetching this resource, and then using `availability.delivery.url` only
when status is `available`. They must not reconstruct legacy `/audio` paths or
infer byte integrity from the host.
