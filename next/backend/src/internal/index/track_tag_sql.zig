pub const filter =
    \\  AND (cardinality($4::text[]) = 0 OR EXISTS (
    \\    SELECT 1 FROM plyr_index.track_tag_records AS tags
    \\    WHERE tags.record_uri = v.record_uri AND tags.record_cid = v.record_cid
    \\      AND tags.tags_present AND tags.tags && plyr_index.normalize_track_tags($4::text[])
    \\  ) OR EXISTS (
    \\    SELECT 1 FROM plyr_index.legacy_track_tags AS annotation
    \\    JOIN plyr_index.track_tag_records AS observed
    \\      ON observed.record_uri = annotation.record_uri
    \\      AND observed.record_cid = annotation.observed_record_cid AND NOT observed.tags_present
    \\    WHERE annotation.record_uri = v.record_uri AND annotation.observed_record_cid = v.record_cid
    \\      AND annotation.tag = ANY(plyr_index.normalize_track_tags($4::text[]))
    \\  ))
;

const effective_values =
    \\ CROSS JOIN LATERAL (
    \\   SELECT name, 'verified_repo'::text AS source FROM unnest(tags.tags) name WHERE tags.tags_present
    \\   UNION ALL
    \\   SELECT annotation.tag, 'legacy_plyr'::text FROM plyr_index.legacy_track_tags annotation
    \\   WHERE NOT tags.tags_present AND annotation.record_uri=v.record_uri
    \\     AND annotation.observed_record_cid=v.record_cid
    \\ ) AS tag(name,source)
;

pub const effective_rows =
    \\ JOIN plyr_index.track_tag_records tags ON tags.record_uri=v.record_uri AND tags.record_cid=v.record_cid
++ "\n" ++ effective_values;

pub const detail_tags =
    \\ array_to_json(ARRAY(
    \\   SELECT DISTINCT tag.name FROM plyr_index.track_tag_records tags
++ "\n" ++ effective_values ++ "\n" ++
    \\   WHERE tags.record_uri=v.record_uri AND tags.record_cid=v.record_cid
    \\   ORDER BY tag.name
    \\ ))::text
;

// Exclusion keys are non-null; uncorrelated sets avoid per-row subplan costs.
pub const hidden_filter =
    \\  AND (cardinality($5::text[]) = 0 OR (
    \\    (v.record_uri, v.record_cid) NOT IN (
    \\      SELECT record_uri, record_cid FROM plyr_index.track_tag_records
    \\      WHERE tags_present AND tags && plyr_index.normalize_track_tags($5::text[])
    \\    )
    \\    AND (v.record_uri, v.record_cid) NOT IN (
    \\      SELECT annotation.record_uri, annotation.observed_record_cid
    \\      FROM plyr_index.legacy_track_tags annotation
    \\      JOIN plyr_index.track_tag_records observed ON observed.record_uri = annotation.record_uri
    \\        AND observed.record_cid = annotation.observed_record_cid AND NOT observed.tags_present
    \\      WHERE annotation.tag = ANY(plyr_index.normalize_track_tags($5::text[]))
    \\    )
    \\    AND v.owner_did NOT IN (
    \\      SELECT owner_did FROM plyr_index.account_label_policies
    \\      WHERE operator_labels ?| $5::text[]
    \\        AND (expires_at_us IS NULL OR expires_at_us > (extract(epoch FROM statement_timestamp()) * 1000000)::bigint)
    \\    )
    \\  ))
;

/// How many of the requested tags ($4) a record carries, with the same verified-over-legacy
/// rule as `filter`. Ranks a multi-tag listing so tracks with every tag come first.
pub fn hits(comptime uri: []const u8, comptime cid: []const u8) []const u8 {
    return "(SELECT count(DISTINCT hit.tag) FROM (" ++
        "SELECT unnest(tags.tags) AS tag FROM plyr_index.track_tag_records AS tags" ++
        " WHERE tags.record_uri = " ++ uri ++ " AND tags.record_cid = " ++ cid ++ " AND tags.tags_present" ++
        " UNION ALL SELECT annotation.tag FROM plyr_index.legacy_track_tags AS annotation" ++
        " JOIN plyr_index.track_tag_records AS observed ON observed.record_uri = annotation.record_uri" ++
        " AND observed.record_cid = annotation.observed_record_cid AND NOT observed.tags_present" ++
        " WHERE annotation.record_uri = " ++ uri ++ " AND annotation.observed_record_cid = " ++ cid ++
        ") AS hit WHERE hit.tag = ANY(plyr_index.normalize_track_tags($4::text[])))";
}
