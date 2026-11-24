//! Ranked public tracks from authenticated, currently available like records.

const std = @import("std");
const pg = @import("pg");
const composed = @import("postgres_composed_track_store.zig");
const track_chart = @import("../domain/track_chart.zig");
const store_module = @import("track_chart_store.zig");
const tag_filter = @import("../domain/tag_filter.zig");

const TrackChartStore = store_module.TrackChartStore;

pub const PostgresTrackChartStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresTrackChartStore) TrackChartStore {
        return .{ .context = self, .list_fn = listOpaque };
    }

    fn listOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.Request,
    ) TrackChartStore.Error![]track_chart.Entry {
        const self: *PostgresTrackChartStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(chart_query, .{
            request.track_collection,
            request.profile_collection,
            request.like_collection,
            request.since_us,
            @as(i64, @intCast(request.limit)),
            if (request.exclude_ai_artists) tag_filter.defaults else &[_][]const u8{},
        }) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("track chart query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("track chart query failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();

        var entries: std.ArrayList(track_chart.Entry) = .empty;
        errdefer entries.deinit(allocator);
        while (result.next() catch return error.IndexUnavailable) |row| {
            const value = composed.decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            const period_count = row.get(i64, composed.projected_column_count) catch return error.CorruptProjection;
            const all_time_count = row.get(i64, composed.projected_column_count + 1) catch return error.CorruptProjection;
            if (period_count <= 0 or all_time_count < period_count)
                return error.CorruptProjection;
            entries.append(allocator, .{
                .rank = entries.items.len + 1,
                .period_like_count = period_count,
                .all_time_like_count = all_time_count,
                .track = value,
            }) catch return error.OutOfMemory;
        }
        return entries.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

/// With AI tags in $6, drops every artist who tagged any of their tracks with
/// one (verified or legacy tags) or carries the operator `ai` account label.
/// The sets are uncorrelated so Postgres builds each once per query.
const ai_artist_filter =
    \\  AND (cardinality($6::text[]) = 0 OR (
    \\    v.owner_did NOT IN (
    \\      SELECT own.owner_did FROM plyr_index.track_records AS own
    \\      JOIN plyr_index.track_tag_records AS tags
    \\        ON tags.record_uri = own.record_uri AND tags.record_cid = own.record_cid
    \\      WHERE NOT own.deleted AND own.collection = $1
    \\        AND tags.tags_present AND tags.tags && plyr_index.normalize_track_tags($6::text[])
    \\    )
    \\    AND v.owner_did NOT IN (
    \\      SELECT own.owner_did FROM plyr_index.track_records AS own
    \\      JOIN plyr_index.legacy_track_tags AS annotation
    \\        ON annotation.record_uri = own.record_uri AND annotation.observed_record_cid = own.record_cid
    \\      JOIN plyr_index.track_tag_records AS observed
    \\        ON observed.record_uri = annotation.record_uri
    \\        AND observed.record_cid = annotation.observed_record_cid AND NOT observed.tags_present
    \\      WHERE NOT own.deleted AND own.collection = $1
    \\        AND annotation.tag = ANY(plyr_index.normalize_track_tags($6::text[]))
    \\    )
    \\    AND v.owner_did NOT IN (
    \\      SELECT owner_did FROM plyr_index.account_label_policies
    \\      WHERE operator_labels ? 'ai'
    \\        AND (expires_at_us IS NULL OR expires_at_us > (extract(epoch FROM statement_timestamp()) * 1000000)::bigint)
    \\    )
    \\  ))
;

const chart_query =
    \\WITH period_likes AS MATERIALIZED (
    \\  SELECT likes.subject_uri, likes.subject_cid,
    \\    COUNT(DISTINCT likes.owner_did)::bigint AS like_count
    \\  FROM plyr_index.like_records AS likes
    \\  JOIN plyr_index.account_availability AS liker_account
    \\    ON liker_account.repo_did = likes.owner_did AND liker_account.available
    \\  WHERE $4::bigint IS NOT NULL AND likes.collection = $3 AND NOT likes.deleted
    \\    AND likes.record_created_at_us >= $4::bigint
    \\  GROUP BY likes.subject_uri, likes.subject_cid
    \\),
    \\ranked_likes AS MATERIALIZED (
    \\  SELECT counts.subject_uri, counts.subject_cid,
    \\    CASE WHEN $4::bigint IS NULL THEN counts.like_count
    \\      ELSE COALESCE(period_likes.like_count, 0) END AS period_like_count,
    \\    counts.like_count AS all_time_like_count
    \\  FROM plyr_index.track_like_counts AS counts
    \\  LEFT JOIN period_likes
    \\    ON period_likes.subject_uri = counts.subject_uri
    \\    AND period_likes.subject_cid = counts.subject_cid
    \\  WHERE counts.collection = $3
    \\),
    \\page AS MATERIALIZED (
    \\  SELECT v.record_uri, ranked_likes.period_like_count, ranked_likes.all_time_like_count
++ "\n" ++ composed.page_from ++ "\n" ++
    \\JOIN ranked_likes ON ranked_likes.subject_uri = v.record_uri
    \\  AND ranked_likes.subject_cid = v.record_cid
    \\WHERE ranked_likes.period_like_count > 0
++ "\n" ++ composed.discovery_policy ++ "\n" ++ ai_artist_filter ++ "\n" ++
    \\ORDER BY ranked_likes.period_like_count DESC,
    \\  ranked_likes.all_time_like_count DESC, v.record_uri ASC
    \\LIMIT $5::bigint
    \\)
    \\SELECT
++ composed.projected_columns ++
    \\, page.period_like_count,
    \\  page.all_time_like_count
    \\FROM page
    \\JOIN plyr_index.track_records AS v ON v.record_uri = page.record_uri
++ "\n" ++ composed.projected_joins ++ "\n" ++
    \\ORDER BY page.period_like_count DESC, page.all_time_like_count DESC, v.record_uri ASC
;
