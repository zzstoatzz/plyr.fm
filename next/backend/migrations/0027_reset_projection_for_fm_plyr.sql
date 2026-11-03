-- next switches from the staging namespace (fm.plyr.stg.*) to the real
-- fm.plyr.* records. Drop the stg projection and everything derived from it;
-- the catalog reconciler rebuilds it from authenticated repo snapshots and the
-- ingester picks up live. Play counts and moderation imported from the stg
-- python tables don't apply to the real records, so they go too.
TRUNCATE
    plyr_index.track_records,
    plyr_index.list_records,
    plyr_index.list_members,
    plyr_index.like_records,
    plyr_index.profile_records,
    plyr_index.record_rejections,
    plyr_index.repo_heads,
    plyr_index.relay_cursors,
    plyr_index.account_availability,
    plyr_index.account_status_checks,
    plyr_index.track_delivery_origins,
    plyr_index.track_mirror_attempts,
    plyr_index.track_policies,
    plyr_index.track_metrics,
    plyr_command.record_keys;
