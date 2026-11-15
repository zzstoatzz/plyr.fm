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
