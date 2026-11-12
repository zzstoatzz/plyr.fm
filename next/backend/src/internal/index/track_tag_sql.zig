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

pub const effective_rows =
    \\ JOIN plyr_index.track_tag_records tags ON tags.record_uri=v.record_uri AND tags.record_cid=v.record_cid
    \\ CROSS JOIN LATERAL (
    \\   SELECT name, 'verified_repo'::text AS source FROM unnest(tags.tags) name WHERE tags.tags_present
    \\   UNION ALL
    \\   SELECT annotation.tag, 'legacy_plyr'::text FROM plyr_index.legacy_track_tags annotation
    \\   WHERE NOT tags.tags_present AND annotation.record_uri=v.record_uri
    \\     AND annotation.observed_record_cid=v.record_cid
    \\ ) AS tag(name,source)
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
