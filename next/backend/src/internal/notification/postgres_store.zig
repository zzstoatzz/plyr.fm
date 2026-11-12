//! PostgreSQL notifications: a read over the verified projection plus one
//! read-watermark row per account.
//!
//! Each notification sorts by its record's createdAt, clamped to when plyr
//! indexed the record so a future-dated record cannot pin itself above
//! everything else. Neither value moves when a repository is re-verified or
//! the projection is rebuilt, so read state survives both.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const store_module = @import("store.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

const NotificationStore = store_module.NotificationStore;
const Error = NotificationStore.Error;

pub const PostgresNotificationStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresNotificationStore) NotificationStore {
        return .{
            .context = self,
            .list_fn = listOpaque,
            .count_unread_fn = countUnreadOpaque,
            .seen_at_fn = seenAtOpaque,
            .mark_seen_fn = markSeenOpaque,
        };
    }

    fn listOpaque(context: *anyopaque, allocator: std.mem.Allocator, request: store_module.ListRequest) Error![]store_module.Item {
        const self: *PostgresNotificationStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        const limit: i64 = @intCast(request.limit);
        const collections = request.collections;
        var result = if (request.before) |before|
            conn.query(before_query, .{
                request.recipient_did,
                collections.track,
                collections.like,
                collections.profile,
                before.created_at_us,
                before.at_uri,
                limit,
            }) catch |err| {
                logQueryError(conn, err);
                return error.IndexUnavailable;
            }
        else
            conn.query(first_query, .{
                request.recipient_did,
                collections.track,
                collections.like,
                collections.profile,
                limit,
            }) catch |err| {
                logQueryError(conn, err);
                return error.IndexUnavailable;
            };
        defer result.deinit();

        var items: std.ArrayList(store_module.Item) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch return error.IndexUnavailable) |row| {
            const item = decodeRow(allocator, row, request) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            items.append(allocator, item) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    fn countUnreadOpaque(context: *anyopaque, recipient_did: []const u8, collections: store_module.Collections, seen_at_us: ?i64) Error!i64 {
        const self: *PostgresNotificationStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var row = (conn.row(count_query, .{
            recipient_did,
            collections.track,
            collections.like,
            seen_at_us orelse -1,
        }) catch |err| {
            logQueryError(conn, err);
            return error.IndexUnavailable;
        }) orelse return error.CorruptProjection;
        defer row.deinit() catch {};
        const count = row.get(i64, 0) catch return error.CorruptProjection;
        if (count < 0) return error.CorruptProjection;
        return count;
    }

    fn seenAtOpaque(context: *anyopaque, recipient_did: []const u8) Error!?i64 {
        const self: *PostgresNotificationStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var row = (conn.row(seen_query, .{recipient_did}) catch |err| {
            logQueryError(conn, err);
            return error.IndexUnavailable;
        }) orelse return null;
        defer row.deinit() catch {};
        const value = row.get(i64, 0) catch return error.CorruptProjection;
        if (value < 0) return error.CorruptProjection;
        return value;
    }

    fn markSeenOpaque(context: *anyopaque, recipient_did: []const u8, seen_at: []const u8) Error!i64 {
        const self: *PostgresNotificationStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var row = (conn.row(mark_seen_query, .{ recipient_did, seen_at }) catch |err| {
            logQueryError(conn, err);
            return error.IndexUnavailable;
        }) orelse return error.IndexUnavailable;
        defer row.deinit() catch {};
        return row.get(i64, 0) catch return error.CorruptProjection;
    }
};

fn decodeRow(allocator: std.mem.Allocator, row: anytype, request: store_module.ListRequest) !store_module.Item {
    const reason = store_module.Reason.parse(try row.get([]const u8, 0)) orelse return error.CorruptReason;
    const uri = try allocator.dupe(u8, try row.get([]const u8, 1));
    const cid = try allocator.dupe(u8, try row.get([]const u8, 2));
    const author_did = try allocator.dupe(u8, try row.get([]const u8, 3));
    const subject_uri = try allocator.dupe(u8, try row.get([]const u8, 4));
    const subject_title = try allocator.dupe(u8, try row.get([]const u8, 5));
    const created_at = try allocator.dupe(u8, try row.get([]const u8, 6));
    const sort_at_us = try row.get(i64, 7);
    const handle = try duplicateOptional(allocator, try row.get(?[]const u8, 8));
    const display_name = try duplicateOptional(allocator, try row.get(?[]const u8, 9));
    const avatar = try duplicateOptional(allocator, try row.get(?[]const u8, 10));

    // the projection's own invariants, checked rather than trusted
    const parsed = zat.AtUri.parse(uri) orelse return error.CorruptUri;
    if (!std.mem.eql(u8, parsed.authority(), author_did) or zat.Did.parse(author_did) == null)
        return error.CorruptUri;
    if (std.mem.eql(u8, author_did, request.recipient_did)) return error.CorruptAuthor;
    const subject = zat.AtUri.parse(subject_uri) orelse return error.CorruptSubject;
    switch (reason) {
        .like => if (!std.mem.eql(u8, subject.authority(), request.recipient_did)) return error.CorruptSubject,
        .feature => if (!std.mem.eql(u8, subject_uri, uri)) return error.CorruptSubject,
    }
    if (sort_at_us < 0) return error.CorruptSortKey;
    if (handle) |value| if (zat.Handle.parse(value) == null) return error.CorruptAuthor;

    return .{
        .reason = reason,
        .uri = uri,
        .cid = cid,
        .author = .{
            .did = author_did,
            .handle = handle,
            .display_name = display_name,
            .avatar = avatar,
        },
        .subject_uri = subject_uri,
        .subject_title = subject_title,
        .created_at = created_at,
        .sort_at_us = sort_at_us,
    };
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try allocator.dupe(u8, present) else null;
}

fn logQueryError(conn: *pg.Conn, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("notification query failed: {}: {s}", .{ err, pg_err.message })
    else
        std.log.err("notification query failed: {}", .{err});
}

// $1 recipient DID, $2 track collection, $3 like collection
const events =
    \\WITH events AS (
    \\  SELECT 'like'::text AS reason,
    \\    likes.record_uri AS uri, likes.record_cid AS cid, likes.owner_did AS author_did,
    \\    tracks.record_uri AS subject_uri, tracks.title AS subject_title,
    \\    likes.record_created_at AS created_at,
    \\    LEAST(likes.record_created_at_us, likes.indexed_at_us) AS sort_at_us
    \\  FROM plyr_index.track_records AS tracks
    \\  JOIN plyr_index.like_records AS likes
    \\    ON likes.subject_uri = tracks.record_uri
    \\    AND likes.collection = $3 AND NOT likes.deleted
    \\    AND likes.record_created_at_us IS NOT NULL
    \\  WHERE tracks.owner_did = $1 AND tracks.collection = $2 AND NOT tracks.deleted
    \\    AND likes.owner_did <> $1
    \\  UNION ALL
    \\  SELECT 'feature'::text,
    \\    tracks.record_uri, tracks.record_cid, tracks.owner_did,
    \\    tracks.record_uri, tracks.title,
    \\    tracks.record_created_at,
    \\    LEAST(tracks.record_created_at_us, tracks.indexed_at_us)
    \\  FROM plyr_index.track_records AS tracks
    \\  WHERE tracks.featured_dids @> ARRAY[$1::text] AND NOT tracks.deleted
    \\    AND tracks.collection = $2 AND tracks.owner_did <> $1
    \\    AND tracks.record_created_at_us IS NOT NULL
    \\    AND tracks.audio_space IS NULL
    \\)
;

// only authors whose accounts are currently available
const available =
    \\JOIN plyr_index.account_availability AS availability
    \\  ON availability.repo_did = events.author_did AND availability.available
;

// $4 profile collection
const list_columns =
    \\SELECT events.reason, events.uri, events.cid, events.author_did,
    \\  events.subject_uri, events.subject_title, events.created_at, events.sort_at_us,
    \\  lower(actor.handle),
    \\  actor.display_name,
    \\  CASE WHEN actor.did IS NULL THEN NULL ELSE CASE WHEN actor.avatar_url IS NOT NULL AND profile.avatar LIKE 'https://cdn.bsky.app/img/avatar/plain/%' THEN actor.avatar_url ELSE COALESCE(NULLIF(profile.avatar, ''), actor.avatar_url) END END
    \\FROM events
;

const list_joins =
    \\LEFT JOIN plyr_index.actor_identities AS actor
    \\  ON actor.did = events.author_did
    \\LEFT JOIN plyr_index.profile_records AS profile
    \\  ON profile.owner_did = events.author_did AND profile.collection = $4
    \\  AND profile.rkey = 'self' AND NOT profile.deleted
;

const first_query = events ++ "\n" ++ list_columns ++ "\n" ++ available ++ "\n" ++ list_joins ++ "\n" ++
    \\ORDER BY events.sort_at_us DESC, events.uri DESC
    \\LIMIT $5::bigint
;

// $5, $6: the cursor's (sort instant, uri)
const before_query = events ++ "\n" ++ list_columns ++ "\n" ++ available ++ "\n" ++ list_joins ++ "\n" ++
    \\WHERE events.sort_at_us < $5::bigint
    \\  OR (events.sort_at_us = $5::bigint AND events.uri < $6)
    \\ORDER BY events.sort_at_us DESC, events.uri DESC
    \\LIMIT $7::bigint
;

// $4 the watermark, -1 when the account has never read
const count_query = events ++ "\n" ++
    \\SELECT count(*)::bigint FROM events
++ "\n" ++ available ++ "\n" ++
    \\WHERE events.sort_at_us > $4::bigint
;

const seen_query =
    \\SELECT seen_at_us FROM plyr_account.notification_seen WHERE owner_did = $1
;

const mark_seen_query =
    \\INSERT INTO plyr_account.notification_seen (owner_did, seen_at_us)
    \\VALUES ($1, LEAST(
    \\  (extract(epoch FROM $2::timestamptz) * 1000000)::bigint,
    \\  (extract(epoch FROM clock_timestamp()) * 1000000)::bigint))
    \\ON CONFLICT (owner_did) DO UPDATE SET
    \\  seen_at_us = GREATEST(plyr_account.notification_seen.seen_at_us, EXCLUDED.seen_at_us),
    \\  updated_at = clock_timestamp()
    \\RETURNING seen_at_us
;

// --- tests -----------------------------------------------------------------

test "PostgreSQL notifications: likes and features, newest first, read by watermark" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const database_uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, database_uri, .{ .size = 1 });
    defer pool.deinit();
    var name = (try pool.row("SELECT current_database()", .{})).?;
    const disposable = std.mem.eql(u8, try name.get([]const u8, 0), "zig_test");
    try name.deinit();
    if (!disposable) return error.UnsafeTestDatabase;

    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_account CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_account CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try @import("../projection/postgres_track_store.zig").createTestTable(pool);
    try @import("../projection/postgres_like_store.zig").createTestTable(pool);
    try @import("../projection/postgres_profile_store.zig").createTestTable(pool);
    try @import("../account/postgres_availability_store.zig").createTestTable(pool);
    try @import("../identity/postgres_actor_identity_store.zig").createTestTable(pool);
    _ = try pool.exec(@embedFile("migration_0039_notification_seen"), .{});

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    const cid = try (try zat.Cid.forDagCbor(a, "record")).toString(a);
    const commit = try (try zat.Cid.forDagCbor(a, "commit")).toString(a);
    const rev = zat.Tid.fromTimestamp(1_000, 1).str();
    const me = "did:plc:artist";
    const collections: store_module.Collections = .{
        .track = "fm.plyr.dev.track",
        .like = "fm.plyr.dev.like",
        .profile = "fm.plyr.dev.actor.profile",
    };
    // indexed far later than created, except where noted
    const late: i64 = 4_000_000_000_000_000;

    _ = try pool.exec(
        \\INSERT INTO plyr_index.account_availability VALUES
        \\  ('did:plc:artist', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:fan', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:peer', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:gone', false, 'suspended', 'current_pds', NULL, NULL, 'https://pds.example', 1000)
    , .{ rev, commit });
    _ = try pool.exec(
        \\INSERT INTO plyr_index.actor_identities VALUES
        \\  ('did:plc:fan', 'Fan.Example', 'Fan', 'https://cdn.example/fan.jpg', NULL, 0, 0, 0)
    , .{});

    const track_columns =
        \\INSERT INTO plyr_index.track_records (record_uri, record_cid, owner_did, collection, rkey,
        \\  title, artist_name, file_type, record_created_at, audio_url, featured_dids, audio_space,
        \\  deleted, commit_cid, commit_rev, indexed_at_us)
    ;
    _ = try pool.exec(track_columns ++
        \\ VALUES
        \\  ('at://did:plc:artist/fm.plyr.dev.track/song', $1, 'did:plc:artist', 'fm.plyr.dev.track', 'song',
        \\   'Song', 'Artist', 'mp3', '2026-01-01T00:00:00Z', 'https://a.example/song.mp3', '{}', NULL, false, $2, $3, $4),
        \\  ('at://did:plc:peer/fm.plyr.dev.track/collab', $1, 'did:plc:peer', 'fm.plyr.dev.track', 'collab',
        \\   'Collab', 'Peer', 'mp3', '2026-01-03T00:00:00Z', 'https://a.example/collab.mp3', '{did:plc:artist}', NULL, false, $2, $3, $4),
        \\  ('at://did:plc:peer/fm.plyr.dev.track/secret', $1, 'did:plc:peer', 'fm.plyr.dev.track', 'secret',
        \\   'Secret', 'Peer', 'mp3', '2026-01-04T00:00:00Z', 'https://a.example/secret.mp3', '{did:plc:artist}', 'at://did:plc:peer/space/x/y', false, $2, $3, $4),
        \\  ('at://did:plc:artist/fm.plyr.dev.track/self', $1, 'did:plc:artist', 'fm.plyr.dev.track', 'self',
        \\   'Self', 'Artist', 'mp3', '2026-01-05T00:00:00Z', 'https://a.example/self.mp3', '{did:plc:artist}', NULL, false, $2, $3, $4)
    , .{ cid, commit, rev, late });

    const like_columns =
        \\INSERT INTO plyr_index.like_records (record_uri, record_cid, owner_did, collection, rkey,
        \\  subject_uri, subject_cid, record_created_at, deleted, commit_cid, commit_rev, indexed_at_us)
    ;
    _ = try pool.exec(like_columns ++
        \\ VALUES
        \\  ('at://did:plc:fan/fm.plyr.dev.like/a', $1, 'did:plc:fan', 'fm.plyr.dev.like', 'a',
        \\   'at://did:plc:artist/fm.plyr.dev.track/song', $1, '2026-01-02T00:00:00Z', false, $2, $3, $4),
        \\  ('at://did:plc:artist/fm.plyr.dev.like/mine', $1, 'did:plc:artist', 'fm.plyr.dev.like', 'mine',
        \\   'at://did:plc:artist/fm.plyr.dev.track/song', $1, '2026-01-06T00:00:00Z', false, $2, $3, $4),
        \\  ('at://did:plc:gone/fm.plyr.dev.like/b', $1, 'did:plc:gone', 'fm.plyr.dev.like', 'b',
        \\   'at://did:plc:artist/fm.plyr.dev.track/song', $1, '2026-01-07T00:00:00Z', false, $2, $3, $4),
        \\  ('at://did:plc:peer/fm.plyr.dev.like/c', NULL, 'did:plc:peer', 'fm.plyr.dev.like', 'c',
        \\   NULL, NULL, NULL, true, $2, $3, $4),
        \\  ('at://did:plc:peer/fm.plyr.dev.like/future', $1, 'did:plc:peer', 'fm.plyr.dev.like', 'future',
        \\   'at://did:plc:artist/fm.plyr.dev.track/song', $1, '2999-01-01T00:00:00Z', false, $2, $3, 1767484800000000)
    , .{ cid, commit, rev, late });

    var implementation: PostgresNotificationStore = .{ .pool = pool };
    const notifications = implementation.store();

    // the future-dated like sorts at its index time (2026-01-04), not 2999;
    // self-likes, self-features, unavailable likers, tombstones and private
    // tracks never appear
    const all = try notifications.list(a, .{ .recipient_did = me, .collections = collections, .limit = 10, .before = null });
    try std.testing.expectEqual(@as(usize, 3), all.len);
    try std.testing.expectEqual(store_module.Reason.like, all[0].reason);
    try std.testing.expectEqualStrings("at://did:plc:peer/fm.plyr.dev.like/future", all[0].uri);
    try std.testing.expectEqual(@as(i64, 1_767_484_800_000_000), all[0].sort_at_us);
    try std.testing.expectEqualStrings("2999-01-01T00:00:00Z", all[0].created_at);
    try std.testing.expectEqual(store_module.Reason.feature, all[1].reason);
    try std.testing.expectEqualStrings("at://did:plc:peer/fm.plyr.dev.track/collab", all[1].subject_uri);
    try std.testing.expectEqualStrings("Collab", all[1].subject_title);
    try std.testing.expectEqual(store_module.Reason.like, all[2].reason);
    try std.testing.expectEqualStrings("did:plc:fan", all[2].author.did);
    try std.testing.expectEqualStrings("fan.example", all[2].author.handle.?);
    try std.testing.expectEqualStrings("https://cdn.example/fan.jpg", all[2].author.avatar.?);
    try std.testing.expectEqualStrings("Song", all[2].subject_title);
    try std.testing.expect(all[1].author.handle == null);

    // keyset paging walks the same order without repeats
    const page = try notifications.list(a, .{ .recipient_did = me, .collections = collections, .limit = 1, .before = .{
        .created_at_us = all[0].sort_at_us,
        .at_uri = all[0].uri,
    } });
    try std.testing.expectEqual(@as(usize, 1), page.len);
    try std.testing.expectEqualStrings(all[1].uri, page[0].uri);

    try std.testing.expectEqual(@as(?i64, null), try notifications.seenAt(me));
    try std.testing.expectEqual(@as(i64, 3), try notifications.countUnread(me, collections, null));
    try std.testing.expectEqual(all[1].sort_at_us, try notifications.markSeen(me, "2026-01-03T00:00:00Z"));
    try std.testing.expectEqual(@as(i64, 1), try notifications.countUnread(me, collections, all[1].sort_at_us));
    // the watermark never moves backwards
    try std.testing.expectEqual(all[1].sort_at_us, try notifications.markSeen(me, "2026-01-02T00:00:00.000Z"));
    // nor past now: a far-future watermark would hide what arrives later
    const now_us = std.Io.Timestamp.now(io, .real).toMicroseconds();
    const clamped = try notifications.markSeen("did:plc:fan", "2999-01-01T00:00:00Z");
    try std.testing.expect(clamped <= now_us + std.time.us_per_min and clamped >= now_us - std.time.us_per_min);
    try std.testing.expectEqual(@as(?i64, all[1].sort_at_us), try notifications.seenAt(me));
    try std.testing.expectEqual(@as(?i64, null), try notifications.seenAt("did:plc:peer"));
    try std.testing.expectEqual(@as(usize, 0), (try notifications.list(a, .{ .recipient_did = "did:plc:fan", .collections = collections, .limit = 10, .before = null })).len);
}
