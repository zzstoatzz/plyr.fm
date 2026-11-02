-- converted from alembic revision e53a9d6c214f (add_track_moderation_policies) on codex/zig-backend

ALTER TABLE plyr_index.track_policies ADD COLUMN operator_labels JSONB DEFAULT '[]' NOT NULL;

ALTER TABLE plyr_index.track_policies ADD COLUMN moderation_decision TEXT;

ALTER TABLE plyr_index.track_policies ADD COLUMN moderation_write_source TEXT;

ALTER TABLE plyr_index.track_policies ADD COLUMN moderation_observed_at_us BIGINT;

ALTER TABLE plyr_index.track_policies ADD CONSTRAINT ck_track_policies_labels CHECK (jsonb_typeof(operator_labels) = 'array' AND operator_labels <@ '["copyright-violation", "porn", "sexual"]'::jsonb AND jsonb_array_length(operator_labels) <= 3);

ALTER TABLE plyr_index.track_policies ADD CONSTRAINT ck_track_policies_moderation_decision CHECK (moderation_decision IS NULL OR moderation_decision IN ('allow', 'exclude'));

ALTER TABLE plyr_index.track_policies ADD CONSTRAINT ck_track_policies_moderation_shape CHECK ((jsonb_array_length(operator_labels) = 0 AND moderation_decision IS NULL AND moderation_write_source IS NULL AND moderation_observed_at_us IS NULL) OR ((jsonb_array_length(operator_labels) > 0 OR moderation_decision IS NOT NULL) AND moderation_write_source IN ('legacy_import', 'labeler_sync') AND moderation_observed_at_us >= 0));

ALTER TABLE plyr_index.track_policies ADD CONSTRAINT ck_track_policies_nonempty CHECK (visibility IS NOT NULL OR jsonb_array_length(operator_labels) > 0 OR moderation_decision IS NOT NULL);

INSERT INTO plyr_index.track_policies (
            record_uri, operator_labels, moderation_decision,
            moderation_write_source, moderation_observed_at_us
        )
        SELECT
            t.atproto_record_uri,
            to_jsonb(ARRAY(
                SELECT value
                FROM jsonb_array_elements_text(t.operator_labels) AS value
                WHERE value IN ('copyright-violation', 'porn', 'sexual')
                ORDER BY value
            )),
            CASE
                WHEN t.moderation_override IN ('allow', 'exclude')
                THEN t.moderation_override
                ELSE NULL
            END,
            'legacy_import',
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
        FROM public.tracks AS t
        WHERE t.atproto_record_uri IS NOT NULL
          AND t.atproto_record_uri <> ''
          AND (
              t.operator_labels ?| ARRAY[
                  'copyright-violation', 'porn', 'sexual'
              ]
              OR t.moderation_override IN ('allow', 'exclude')
          )
        ON CONFLICT (record_uri) DO UPDATE SET
            operator_labels = EXCLUDED.operator_labels,
            moderation_decision = EXCLUDED.moderation_decision,
            moderation_write_source = EXCLUDED.moderation_write_source,
            moderation_observed_at_us = EXCLUDED.moderation_observed_at_us;
