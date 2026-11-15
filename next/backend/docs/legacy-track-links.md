# legacy track links

Production track numbers belong to the legacy catalog. An AT record replay
restores track identity and metadata without the number. Before retiring the
legacy database, keep its number-to-record manifest with the Next database
backup. A valid number must continue to point to the same AT URI across restores.

Export the mapping from a read-only transaction on the legacy production
database. This includes direct unlisted links and excludes owner-only tracks.

```sql
SELECT id AS legacy_id, atproto_record_uri AS record_uri
FROM public.tracks
WHERE visibility <> 'private'
  AND coalesce(support_gate->>'type', '') <> 'owner'
  AND atproto_record_uri ~ '^at://did:[^/]+/fm[.]plyr[.]track/[A-Za-z0-9._~:-]+$'
  AND split_part(atproto_record_uri, '/', 3) = artist_did
ORDER BY id;
```

After migration 0044, verify that the destination database has the
`plyr-zig-next` database comment. Check that both manifest columns are unique.
Insert the manifest into `plyr_index.legacy_track_links` with
`ON CONFLICT DO NOTHING` and compare the resulting pairs against the manifest.
Investigate a mismatch before a restore or cutover. Live track availability is
checked separately by the normal verified track lookup.

Smoke `GET /v1/tracks/1667` and the returned track's canonical ID. Both should
return the same record URI, canonical ID and current CID.

## unlisted visibility

Next authors can set `visibility: "unlisted"` on a track record. The verifier
projects that declaration with the signed revision. Existing unlisted tracks
published by the legacy application may have no declaration. Before exposing
a rebuilt index, refresh the legacy policy snapshot in a read-only transaction.
Use the same canonical URI and owner checks as the link export, with
`visibility = 'unlisted'`.

On the database marked `plyr-zig-next`, write these URIs to
`plyr_index.track_policies` with `visibility='unlisted'`,
`access_write_source='legacy_import'`, and an observation timestamp in
microseconds. Fill missing visibility only and preserve existing moderation
fields. Compare the resulting policies with the snapshot before cutover and
resolve any conflicting explicit settings. Verify a direct link still opens
and that search omits the track.
