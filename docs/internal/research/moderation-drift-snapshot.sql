WITH current_labels AS (
 SELECT DISTINCT ON (src, uri, val) seq, src, uri, cid, val, neg, cts, exp
 FROM labels ORDER BY src, uri, val, seq DESC
), active AS (
 SELECT * FROM current_labels WHERE NOT neg AND (exp IS NULL OR exp > now())
), opened AS (
 SELECT DISTINCT ON (subject_uri) subject_uri, id, created_at
 FROM moderation_events WHERE action IN ('flagged_by_scan', 'reported')
 ORDER BY subject_uri, id DESC
), closed AS (
 SELECT DISTINCT ON (subject_uri) subject_uri, id
 FROM moderation_events WHERE action IN ('acknowledged', 'override_allow', 'override_exclude', 'takedown')
 ORDER BY subject_uri, id DESC
), queue AS (
 SELECT o.* FROM opened o LEFT JOIN closed c USING (subject_uri)
 WHERE c.id IS NULL OR c.id < o.id
), policy AS (
 SELECT DISTINCT ON (subject_uri) subject_uri, id, action
 FROM moderation_events WHERE action IN ('indexing_exclude', 'indexing_clear')
 ORDER BY subject_uri, id DESC
)
SELECT json_build_object(
 'observed_at', now(),
 'label_events', (SELECT count(*) FROM labels),
 'active_labels', (SELECT coalesce(json_agg(active ORDER BY uri,val), '[]'::json) FROM active),
 'reasserted_after_negation', (SELECT count(*) FROM active a WHERE EXISTS (
 SELECT 1 FROM labels n WHERE n.src=a.src AND n.uri=a.uri AND n.val=a.val AND n.neg AND n.seq<a.seq)),
 'open_review_subjects', (SELECT count(*) FROM queue),
 'oldest_open_review', (SELECT min(created_at) FROM queue),
 'excluded_subjects', (SELECT count(*) FROM policy WHERE action='indexing_exclude'),
 'context_track_id_present', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='label_context' AND column_name='track_id')
) AS snapshot;
