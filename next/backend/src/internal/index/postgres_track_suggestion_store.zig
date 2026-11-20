//! Tracks that go with a set of seeds, scored from what listeners already do
//! with them: liked by the same people, kept in the same lists, sharing tags,
//! and made by the same artist. No embeddings; everything here is derived
//! from the projection, so a replay rebuilds it.

const std = @import("std");
const pg = @import("pg");
const composed = @import("postgres_composed_track_store.zig");
const track = @import("../domain/track.zig");
const store_module = @import("track_suggestion_store.zig");

const TrackSuggestionStore = store_module.TrackSuggestionStore;

pub const PostgresTrackSuggestionStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresTrackSuggestionStore) TrackSuggestionStore {
        return .{ .context = self, .list_fn = listOpaque };
    }

    fn listOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.Request,
    ) TrackSuggestionStore.Error![]track.Track {
        const self: *PostgresTrackSuggestionStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(suggestion_query, .{
            request.track_collection,
            request.profile_collection,
            request.like_collection,
            request.seeds,
            request.exclude,
            @as(i64, @intCast(request.limit)),
        }) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("track suggestion query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("track suggestion query failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();

        var tracks: std.ArrayList(track.Track) = .empty;
        errdefer tracks.deinit(allocator);
        while (result.next() catch return error.IndexUnavailable) |row| {
            const value = composed.decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            tracks.append(allocator, value) catch return error.OutOfMemory;
        }
        return tracks.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

// Weights: a shared liker is the strongest sign two tracks go together, a
// shared list next, then each shared tag (at most three count) and the same
// artist. Within one artist each further track counts for less, so one
// prolific artist cannot fill the whole list.
const suggestion_query =
    \\WITH seeds AS MATERIALIZED (
    \\  SELECT v.record_uri, v.owner_did
    \\  FROM plyr_index.track_records AS v
    \\  WHERE v.record_uri = ANY($4::text[]) AND v.collection = $1 AND NOT v.deleted
    \\),
    \\liked_together AS (
    \\  SELECT other.subject_uri AS uri, 3.0 * COUNT(DISTINCT other.owner_did) AS score
    \\  FROM seeds
    \\  JOIN plyr_index.like_records AS seed_like
    \\    ON seed_like.subject_uri = seeds.record_uri AND seed_like.collection = $3 AND NOT seed_like.deleted
    \\  JOIN plyr_index.like_records AS other
    \\    ON other.owner_did = seed_like.owner_did AND other.collection = $3 AND NOT other.deleted
    \\  GROUP BY other.subject_uri
    \\),
    \\listed_together AS (
    \\  SELECT other.track_uri AS uri, 2.0 * COUNT(DISTINCT other.list_uri) AS score
    \\  FROM seeds
    \\  JOIN plyr_index.list_members AS seed_member ON seed_member.track_uri = seeds.record_uri
    \\  JOIN plyr_index.list_records AS lists ON lists.record_uri = seed_member.list_uri AND NOT lists.deleted
    \\  JOIN plyr_index.list_members AS other ON other.list_uri = seed_member.list_uri
    \\  GROUP BY other.track_uri
    \\),
    \\seed_tags AS (
    \\  SELECT DISTINCT tag.name
    \\  FROM seeds
    \\  JOIN plyr_index.track_tag_records AS tags ON tags.record_uri = seeds.record_uri AND tags.tags_present
    \\  CROSS JOIN LATERAL unnest(tags.tags) AS tag(name)
    \\),
    \\tagged_together AS (
    \\  SELECT tags.record_uri AS uri, LEAST(COUNT(*), 3)::float8 AS score
    \\  FROM plyr_index.track_tag_records AS tags
    \\  CROSS JOIN LATERAL unnest(tags.tags) AS tag(name)
    \\  JOIN seed_tags ON seed_tags.name = tag.name
    \\  WHERE tags.tags_present
    \\  GROUP BY tags.record_uri
    \\),
    \\same_artist AS (
    \\  SELECT v.record_uri AS uri, 1.5::float8 AS score
    \\  FROM plyr_index.track_records AS v
    \\  WHERE v.owner_did IN (SELECT owner_did FROM seeds) AND v.collection = $1 AND NOT v.deleted
    \\),
    \\scored AS (
    \\  SELECT uri, SUM(score)::float8 AS score FROM (
    \\    SELECT uri, score::float8 FROM liked_together
    \\    UNION ALL SELECT uri, score::float8 FROM listed_together
    \\    UNION ALL SELECT uri, score FROM tagged_together
    \\    UNION ALL SELECT uri, score FROM same_artist
    \\  ) AS signals
    \\  WHERE uri IS NOT NULL
    \\  GROUP BY uri
    \\),
    \\candidates AS MATERIALIZED (
    \\  SELECT v.record_uri, v.owner_did, scored.score,
    \\    COALESCE(likes.like_count, 0) AS like_count
++ "\n" ++ composed.page_from ++ "\n" ++
    \\JOIN scored ON scored.uri = v.record_uri
    \\LEFT JOIN plyr_index.track_like_counts AS likes
    \\  ON likes.collection = $3 AND likes.subject_uri = v.record_uri AND likes.subject_cid = v.record_cid
    \\WHERE v.record_uri <> ALL($4::text[]) AND v.record_uri <> ALL($5::text[])
++ "\n" ++ composed.discovery_policy ++ "\n" ++
    \\),
    \\page AS MATERIALIZED (
    \\  SELECT record_uri,
    \\    score / (1 + 0.5 * (ROW_NUMBER() OVER (
    \\      PARTITION BY owner_did ORDER BY score DESC, like_count DESC, record_uri) - 1)) AS rank_score,
    \\    like_count
    \\  FROM candidates
    \\  ORDER BY rank_score DESC, like_count DESC, record_uri ASC
    \\  LIMIT $6::bigint
    \\)
    \\SELECT
++ composed.projected_columns ++
    \\
    \\FROM page
    \\JOIN plyr_index.track_records AS v ON v.record_uri = page.record_uri
++ "\n" ++ composed.projected_joins ++ "\n" ++
    \\ORDER BY page.rank_score DESC, page.like_count DESC, v.record_uri ASC
;
