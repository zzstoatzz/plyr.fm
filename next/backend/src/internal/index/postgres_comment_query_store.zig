//! PostgreSQL reader for verified timed comments on a track.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const comment = @import("../domain/comment.zig");
const comment_record = @import("../atproto/comment_record.zig");
const store_module = @import("comment_query_store.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

const CommentQueryStore = store_module.CommentQueryStore;

pub const PostgresCommentQueryStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresCommentQueryStore) CommentQueryStore {
        return .{ .context = self, .list_by_subject_fn = listBySubjectOpaque };
    }

    fn listBySubjectOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.SubjectRequest,
    ) CommentQueryStore.Error![]comment.Comment {
        const self: *PostgresCommentQueryStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        const limit: i64 = @intCast(request.limit);
        var result = conn.query(query, .{
            request.subject_uri,
            request.comment_collection,
            request.profile_collection,
            limit,
        }) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("comment query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("comment query failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();
        var items: std.ArrayList(comment.Comment) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch return error.IndexUnavailable) |row| {
            const value = decodeRow(allocator, row, request) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            items.append(allocator, value) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

fn decodeRow(
    allocator: std.mem.Allocator,
    row: anytype,
    request: store_module.SubjectRequest,
) !comment.Comment {
    const record_uri = try allocator.dupe(u8, try row.get([]const u8, 0));
    const record_cid = try allocator.dupe(u8, try row.get([]const u8, 1));
    const owner_did = try allocator.dupe(u8, try row.get([]const u8, 2));
    const rkey = try allocator.dupe(u8, try row.get([]const u8, 3));
    const parsed = zat.AtUri.parse(record_uri) orelse return error.CorruptCommentUri;
    if (zat.Did.parse(owner_did) == null or
        !std.mem.eql(u8, parsed.authority(), owner_did) or
        !std.mem.eql(u8, parsed.collection() orelse return error.CorruptCommentUri, request.comment_collection) or
        !std.mem.eql(u8, parsed.rkey() orelse return error.CorruptCommentUri, rkey))
        return error.CorruptCommentUri;
    const subject_uri = try allocator.dupe(u8, try row.get([]const u8, 4));
    if (!std.mem.eql(u8, subject_uri, request.subject_uri)) return error.CorruptSubject;
    const subject_cid = try allocator.dupe(u8, try row.get([]const u8, 5));
    const text = try allocator.dupe(u8, try row.get([]const u8, 6));
    if (text.len == 0 or text.len > comment_record.max_text_bytes) return error.CorruptText;
    const timestamp_ms = try row.get(i64, 7);
    if (timestamp_ms < 0) return error.CorruptTimestamp;
    const created_at = try allocator.dupe(u8, try row.get([]const u8, 8));
    if (!lexicon_value.validDatetime(created_at)) return error.CorruptCreatedAt;
    const updated_at = if (try row.get(?[]const u8, 9)) |value| try allocator.dupe(u8, value) else null;
    const handle = if (try row.get(?[]const u8, 10)) |value| try allocator.dupe(u8, value) else null;
    const display_name = if (try row.get(?[]const u8, 11)) |value| try allocator.dupe(u8, value) else null;
    const avatar = if (try row.get(?[]const u8, 12)) |value| try allocator.dupe(u8, value) else null;
    if (avatar) |value| if (!lexicon_value.validUri(value)) return error.CorruptAvatar;
    return .{
        .record = .{ .uri = record_uri, .cid = record_cid, .rkey = rkey },
        .author = .{ .did = owner_did, .handle = handle, .display_name = display_name, .avatar_url = avatar },
        .subject = .{ .uri = subject_uri, .cid = subject_cid },
        .text = text,
        .timestamp_ms = timestamp_ms,
        .created_at = created_at,
        .updated_at = updated_at,
    };
}

// Same avatar choice as likes: a refreshed identity avatar wins over a copied
// cdn.bsky.app URL that dies when the person changes their bluesky avatar.
const query =
    \\SELECT
    \\  comments.record_uri,
    \\  comments.record_cid,
    \\  comments.owner_did,
    \\  comments.rkey,
    \\  comments.subject_uri,
    \\  comments.subject_cid,
    \\  comments.text,
    \\  comments.timestamp_ms,
    \\  comments.record_created_at,
    \\  comments.record_updated_at,
    \\  lower(actor.handle),
    \\  actor.display_name,
    \\  CASE WHEN actor.did IS NULL THEN NULLIF(profile.avatar, '') ELSE CASE WHEN actor.avatar_url IS NOT NULL AND profile.avatar LIKE 'https://cdn.bsky.app/img/avatar/plain/%' THEN actor.avatar_url ELSE COALESCE(NULLIF(profile.avatar, ''), actor.avatar_url) END END
    \\FROM plyr_index.comment_records AS comments
    \\JOIN plyr_index.account_availability AS availability
    \\  ON availability.repo_did = comments.owner_did AND availability.available
    \\LEFT JOIN plyr_index.actor_identities AS actor
    \\  ON actor.did = comments.owner_did
    \\LEFT JOIN plyr_index.profile_records AS profile
    \\  ON profile.owner_did = comments.owner_did AND profile.collection = $3
    \\  AND profile.rkey = 'self' AND NOT profile.deleted
    \\WHERE comments.subject_uri = $1 AND comments.collection = $2 AND NOT comments.deleted
    \\ORDER BY comments.timestamp_ms, comments.record_created_at_us NULLS LAST, comments.record_uri
    \\LIMIT $4::bigint
;

test "PostgreSQL comments come back in playback order across track versions, from available accounts" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const database_uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, database_uri, .{ .size = 1 });
    defer pool.deinit();
    {
        var row = (try pool.row("SELECT current_database()", .{})).?;
        defer row.deinit() catch {};
        if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
    }
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    const postgres_comment = @import("../projection/postgres_comment_store.zig");
    try postgres_comment.createTestTable(pool);
    try @import("../projection/postgres_profile_store.zig").createTestTable(pool);
    try @import("../account/postgres_availability_store.zig").createTestTable(pool);
    try @import("../identity/postgres_actor_identity_store.zig").createTestTable(pool);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commit_cid = try (try zat.Cid.forDagCbor(a, "commit")).toString(a);
    const rev = zat.Tid.fromTimestamp(1_000, 1).str();
    _ = try pool.exec(
        \\INSERT INTO plyr_index.actor_identities VALUES
        \\  ('did:plc:listenerone', 'One.Example', 'One', 'https://cdn.example/one.jpg', NULL, 0, 0, 0),
        \\  ('did:plc:listenertwo', 'two.example', 'Two', NULL, NULL, 0, 0, 0)
    , .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.account_availability VALUES
        \\  ('did:plc:listenerone', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:listenertwo', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:gone', false, 'suspended', 'current_pds', NULL, NULL, 'https://pds.example', 1000)
    , .{ &rev, commit_cid });

    var comments: postgres_comment.PostgresCommentStore = .{ .pool = pool };
    const subject = "at://did:plc:artist/fm.plyr.dev.track/song";
    const Seed = struct { did: []const u8, rkey: []const u8, cid_seed: []const u8, ms: u64, text: []const u8 };
    const seeds = [_]Seed{
        .{ .did = "did:plc:listenerone", .rkey = "late", .cid_seed = "v1", .ms = 250_000, .text = "the sax here" },
        .{ .did = "did:plc:listenertwo", .rkey = "early", .cid_seed = "v2", .ms = 42_000, .text = "tape hiss" },
        .{ .did = "did:plc:gone", .rkey = "hidden", .cid_seed = "v1", .ms = 1_000, .text = "from a suspended account" },
    };
    for (seeds, 0..) |seed, index| {
        const at: i64 = @intCast(1_000 + index);
        _ = try comments.store().apply(a, .{ .upsert = .{
            .record_uri = try std.fmt.allocPrint(a, "at://{s}/fm.plyr.dev.comment/{s}", .{ seed.did, seed.rkey }),
            .record_cid = try (try zat.Cid.forDagCbor(a, seed.rkey)).toString(a),
            .owner_did = seed.did,
            .collection = "fm.plyr.dev.comment",
            .rkey = seed.rkey,
            .subject_uri = subject,
            .subject_cid = try (try zat.Cid.forDagCbor(a, seed.cid_seed)).toString(a),
            .text = seed.text,
            .timestamp_ms = seed.ms,
            .created_at = "2026-11-14T09:00:00Z",
            .updated_at = null,
            .proof = .{ .commit_cid = null, .commit_rev = &zat.Tid.fromTimestamp(@intCast(at), 1).str(), .indexed_at_us = at },
        } });
    }

    var implementation: PostgresCommentQueryStore = .{ .pool = pool };
    const found = try implementation.store().listBySubject(a, .{
        .subject_uri = subject,
        .comment_collection = "fm.plyr.dev.comment",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .limit = 10,
    });
    try std.testing.expectEqual(@as(usize, 2), found.len);
    try std.testing.expectEqual(@as(i64, 42_000), found[0].timestamp_ms);
    try std.testing.expectEqualStrings("tape hiss", found[0].text);
    try std.testing.expect(found[0].author.avatar_url == null);
    try std.testing.expectEqual(@as(i64, 250_000), found[1].timestamp_ms);
    try std.testing.expectEqualStrings("one.example", found[1].author.handle.?);
    try std.testing.expectEqualStrings("https://cdn.example/one.jpg", found[1].author.avatar_url.?);
}
