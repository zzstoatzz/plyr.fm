//! PostgreSQL reader for verified, exact-subject like records.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const like = @import("../domain/like.zig");
const store_module = @import("like_query_store.zig");

const LikeQueryStore = store_module.LikeQueryStore;

pub const PostgresLikeQueryStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresLikeQueryStore) LikeQueryStore {
        return .{
            .context = self,
            .list_by_subject_fn = listBySubjectOpaque,
            .find_record_key_fn = findRecordKeyOpaque,
        };
    }

    fn listBySubjectOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.SubjectRequest,
    ) LikeQueryStore.Error![]store_module.Item {
        const self: *PostgresLikeQueryStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        const limit: i64 = @intCast(request.limit);
        var result = if (request.after) |after|
            conn.query(after_query, .{
                request.subject_uri,
                request.subject_cid,
                request.like_collection,
                request.profile_collection,
                after.created_at_us,
                after.at_uri,
                limit,
            }) catch |err| {
                logQueryError(conn, err);
                return error.IndexUnavailable;
            }
        else
            conn.query(base_query, .{
                request.subject_uri,
                request.subject_cid,
                request.like_collection,
                request.profile_collection,
                limit,
            }) catch |err| {
                logQueryError(conn, err);
                return error.IndexUnavailable;
            };
        defer result.deinit();

        var items: std.ArrayList(store_module.Item) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch return error.IndexUnavailable) |row| {
            const value = decodeRow(allocator, row, request) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            items.append(allocator, .{
                .value = value,
                .created_at_us = row.get(i64, 16) catch return error.CorruptProjection,
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    fn findRecordKeyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.ActorSubjectRequest,
    ) LikeQueryStore.Error!?[]const u8 {
        const self: *PostgresLikeQueryStore = @ptrCast(@alignCast(context));
        return self.findRecordKey(allocator, request);
    }

    fn findRecordKey(
        self: PostgresLikeQueryStore,
        allocator: std.mem.Allocator,
        request: store_module.ActorSubjectRequest,
    ) LikeQueryStore.Error!?[]const u8 {
        var row = (self.pool.row(
            \\SELECT record_uri, rkey
            \\FROM plyr_index.like_records
            \\WHERE owner_did = $1 AND subject_uri = $2 AND subject_cid = $3
            \\  AND collection = $4 AND NOT deleted
            \\ORDER BY record_created_at::timestamptz DESC, record_uri DESC
            \\LIMIT 1
        , .{
            request.actor_did,
            request.subject_uri,
            request.subject_cid,
            request.like_collection,
        }) catch return error.IndexUnavailable) orelse return null;
        defer row.deinit() catch row.result.deinit();
        const record_uri = row.row.get([]const u8, 0) catch return error.CorruptProjection;
        const rkey = row.row.get([]const u8, 1) catch return error.CorruptProjection;
        const parsed = zat.AtUri.parse(record_uri) orelse return error.CorruptProjection;
        if (!std.mem.eql(u8, parsed.authority(), request.actor_did) or
            !std.mem.eql(u8, parsed.collection() orelse return error.CorruptProjection, request.like_collection) or
            !std.mem.eql(u8, parsed.rkey() orelse return error.CorruptProjection, rkey))
            return error.CorruptProjection;
        return allocator.dupe(u8, rkey) catch return error.OutOfMemory;
    }
};

fn decodeRow(
    allocator: std.mem.Allocator,
    row: anytype,
    request: store_module.SubjectRequest,
) !like.Like {
    const record_uri = try duplicate(allocator, try row.get([]const u8, 0));
    const record_cid = try duplicate(allocator, try row.get([]const u8, 1));
    const owner_did = try duplicate(allocator, try row.get([]const u8, 2));
    const collection = try duplicate(allocator, try row.get([]const u8, 3));
    const rkey = try duplicate(allocator, try row.get([]const u8, 4));
    const parsed_uri = zat.AtUri.parse(record_uri) orelse return error.CorruptLikeUri;
    if (zat.Did.parse(owner_did) == null or
        !std.mem.eql(u8, parsed_uri.authority(), owner_did) or
        !std.mem.eql(u8, parsed_uri.collection() orelse return error.CorruptLikeUri, collection) or
        !std.mem.eql(u8, parsed_uri.rkey() orelse return error.CorruptLikeUri, rkey) or
        !std.mem.eql(u8, collection, request.like_collection))
        return error.CorruptLikeUri;
    try validateCid(allocator, record_cid);

    const subject_uri = try duplicate(allocator, try row.get([]const u8, 5));
    const subject_cid = try duplicate(allocator, try row.get([]const u8, 6));
    if (!std.mem.eql(u8, subject_uri, request.subject_uri) or
        !std.mem.eql(u8, subject_cid, request.subject_cid))
        return error.CorruptSubject;
    try validateCid(allocator, subject_cid);
    const created_at = try duplicate(allocator, try row.get([]const u8, 7));
    if (!lexicon_value.validDatetime(created_at)) return error.CorruptCreatedAt;

    const commit_cid = try duplicate(allocator, try row.get([]const u8, 8));
    try validateCid(allocator, commit_cid);
    const commit_rev = try duplicate(allocator, try row.get([]const u8, 9));
    const indexed_at_us = try row.get(i64, 10);
    if (zat.Tid.parse(commit_rev) == null or indexed_at_us < 0)
        return error.CorruptProof;

    const handle = try duplicateOptional(allocator, try row.get(?[]const u8, 11));
    const display_name = try duplicateOptional(allocator, try row.get(?[]const u8, 12));
    const avatar = try duplicateOptional(allocator, try row.get(?[]const u8, 13));
    if ((handle == null) != (display_name == null)) return error.CorruptActorProfile;
    if (handle) |value| {
        if (zat.Handle.parse(value) == null) return error.CorruptActorProfile;
    } else if (avatar != null) return error.CorruptActorProfile;
    if (avatar) |value| if (!lexicon_value.validUri(value)) return error.CorruptActorProfile;
    const authored_avatar = try row.get(bool, 14);
    if (authored_avatar and avatar == null) return error.CorruptActorProfile;
    const account_source = try parseAccountSource(try row.get([]const u8, 15));

    return .{
        .record = .{
            .uri = record_uri,
            .cid = record_cid,
            .collection = collection,
            .rkey = rkey,
        },
        .actor = .{
            .did = owner_did,
            .profile = if (handle) |present| .{
                .handle = present,
                .display_name = display_name.?,
                .avatar_url = avatar,
            } else null,
        },
        .subject = .{ .uri = subject_uri, .cid = subject_cid },
        .created_at = created_at,
        .sources = .{
            .actor_profile = if (handle == null)
                .derived
            else if (authored_avatar)
                .mixed
            else
                .legacy_projection,
            .account_availability = account_source,
        },
        .projection = .{
            .commit_cid = commit_cid,
            .commit_rev = commit_rev,
            .indexed_at_us = indexed_at_us,
        },
    };
}

fn parseAccountSource(value: []const u8) !@import("../domain/track.zig").Source {
    if (std.mem.eql(u8, value, "verified_repository")) return .verified_repo;
    if (std.mem.eql(u8, value, "current_pds")) return .current_pds;
    return error.CorruptAccountSource;
}

fn validateCid(allocator: std.mem.Allocator, value: []const u8) !void {
    const parsed = try zat.Cid.fromString(allocator, value);
    defer allocator.free(parsed.raw);
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.CorruptCid;
}

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

fn logQueryError(conn: *pg.Conn, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("verified like query failed: {}: {s}", .{ err, pg_err.message })
    else
        std.log.err("verified like query failed: {}", .{err});
}

const columns =
    \\SELECT
    \\  likes.record_uri,
    \\  likes.record_cid,
    \\  likes.owner_did,
    \\  likes.collection,
    \\  likes.rkey,
    \\  likes.subject_uri,
    \\  likes.subject_cid,
    \\  likes.record_created_at,
    \\  likes.commit_cid,
    \\  likes.commit_rev,
    \\  likes.indexed_at_us,
    \\  lower(actor.handle),
    \\  actor.display_name,
    \\  CASE WHEN actor.did IS NULL THEN NULL ELSE COALESCE(profile.avatar, actor.avatar_url) END,
    \\  actor.did IS NOT NULL AND profile.avatar IS NOT NULL,
    \\  availability.evidence_source,
    \\  (extract(epoch FROM likes.record_created_at::timestamptz) * 1000000)::bigint
;

const joins =
    \\FROM plyr_index.like_records AS likes
    \\JOIN plyr_index.account_availability AS availability
    \\  ON availability.repo_did = likes.owner_did AND availability.available
    \\LEFT JOIN artists AS actor
    \\  ON actor.did = likes.owner_did AND NOT actor.deactivated
    \\LEFT JOIN plyr_index.profile_records AS profile
    \\  ON profile.owner_did = likes.owner_did AND profile.collection = $4
    \\  AND profile.rkey = 'self' AND NOT profile.deleted
;

const where =
    \\WHERE likes.subject_uri = $1 AND likes.subject_cid = $2
    \\  AND likes.collection = $3 AND NOT likes.deleted
;

const base_query = columns ++ "\n" ++ joins ++ "\n" ++ where ++ "\n" ++
    \\ORDER BY likes.record_created_at::timestamptz DESC, likes.record_uri DESC
    \\LIMIT $5::bigint
;

const after_query = columns ++ "\n" ++ joins ++ "\n" ++ where ++ "\n" ++
    \\  AND (
    \\    likes.record_created_at::timestamptz < TIMESTAMPTZ 'epoch' + ($5::bigint * INTERVAL '1 microsecond')
    \\    OR (likes.record_created_at::timestamptz = TIMESTAMPTZ 'epoch' + ($5::bigint * INTERVAL '1 microsecond')
    \\      AND likes.record_uri < $6)
    \\  )
    \\ORDER BY likes.record_created_at::timestamptz DESC, likes.record_uri DESC
    \\LIMIT $7::bigint
;

test "PostgreSQL likes require exact subject CIDs and available actors" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    const database_uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, database_uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("DROP TABLE IF EXISTS artists CASCADE", .{});
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try @import("../projection/postgres_like_store.zig").createTestTable(pool);
    try @import("../projection/postgres_profile_store.zig").createTestTable(pool);
    try @import("../account/postgres_availability_store.zig").createTestTable(pool);
    _ = try pool.exec(
        \\CREATE TABLE artists (
        \\  did text PRIMARY KEY, handle text NOT NULL, display_name text NOT NULL,
        \\  bio text, avatar_url text, deactivated boolean NOT NULL DEFAULT false
        \\)
    , .{});

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record_cid = try (try zat.Cid.forDagCbor(a, "like-record")).toString(a);
    const subject_cid = try (try zat.Cid.forDagCbor(a, "track-record")).toString(a);
    const stale_cid = try (try zat.Cid.forDagCbor(a, "stale-track-record")).toString(a);
    const commit_cid = try (try zat.Cid.forDagCbor(a, "commit")).toString(a);
    const rev = zat.Tid.fromTimestamp(1_000, 1).str();
    const subject_uri = "at://did:plc:artist/fm.plyr.dev.track/song";
    const like_collection = "fm.plyr.dev.like";
    const profile_collection = "fm.plyr.dev.actor.profile";

    _ = try pool.exec(
        \\INSERT INTO artists VALUES
        \\  ('did:plc:listenerone', 'one.example', 'One', NULL, 'https://legacy.example/one.jpg', false),
        \\  ('did:plc:listenertwo', 'two.example', 'Two', NULL, NULL, false)
    , .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.account_availability VALUES
        \\  ('did:plc:listenerone', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:listenertwo', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:stale', true, NULL, 'verified_repository', $1, $2, NULL, 1000),
        \\  ('did:plc:unavailable', false, 'suspended', 'current_pds', NULL, NULL, 'https://pds.example', 1000)
    , .{ rev, commit_cid });
    _ = try pool.exec(
        \\INSERT INTO plyr_index.profile_records VALUES (
        \\  'at://did:plc:listenerone/fm.plyr.dev.actor.profile/self',
        \\  $1, 'did:plc:listenerone', $2, 'self', 'https://pds.example/one.jpg',
        \\  NULL, '2026-08-09T00:00:00Z', NULL, false, $3, $4, 1000
        \\)
    , .{ record_cid, profile_collection, commit_cid, rev });
    _ = try pool.exec(
        \\INSERT INTO plyr_index.like_records VALUES
        \\  ('at://did:plc:listenerone/fm.plyr.dev.like/one', $1, 'did:plc:listenerone', $2, 'one', $3, $4, '2026-08-09T04:00:00Z', false, $5, $6, 1000),
        \\  ('at://did:plc:listenertwo/fm.plyr.dev.like/two', $1, 'did:plc:listenertwo', $2, 'two', $3, $4, '2026-08-09T01:00:00Z', false, $5, $6, 1000),
        \\  ('at://did:plc:stale/fm.plyr.dev.like/stale', $1, 'did:plc:stale', $2, 'stale', $3, $7, '2026-08-09T03:00:00Z', false, $5, $6, 1000),
        \\  ('at://did:plc:unavailable/fm.plyr.dev.like/gone', $1, 'did:plc:unavailable', $2, 'gone', $3, $4, '2026-08-09T02:00:00Z', false, $5, $6, 1000)
    , .{ record_cid, like_collection, subject_uri, subject_cid, commit_cid, rev, stale_cid });

    var implementation: PostgresLikeQueryStore = .{ .pool = pool };
    const first = try implementation.store().listBySubject(a, .{
        .subject_uri = subject_uri,
        .subject_cid = subject_cid,
        .like_collection = like_collection,
        .profile_collection = profile_collection,
        .limit = 1,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), first.len);
    try std.testing.expectEqualStrings("did:plc:listenerone", first[0].value.actor.did);
    try std.testing.expectEqualStrings("one.example", first[0].value.actor.profile.?.handle);
    try std.testing.expectEqual(
        @import("../domain/track.zig").Source.mixed,
        first[0].value.sources.actor_profile,
    );
    const existing_rkey = (try implementation.store().findRecordKey(a, .{
        .actor_did = "did:plc:listenerone",
        .subject_uri = subject_uri,
        .subject_cid = subject_cid,
        .like_collection = like_collection,
    })).?;
    try std.testing.expectEqualStrings("one", existing_rkey);
    try std.testing.expect((try implementation.store().findRecordKey(a, .{
        .actor_did = "did:plc:nobody",
        .subject_uri = subject_uri,
        .subject_cid = subject_cid,
        .like_collection = like_collection,
    })) == null);
    const second = try implementation.store().listBySubject(a, .{
        .subject_uri = subject_uri,
        .subject_cid = subject_cid,
        .like_collection = like_collection,
        .profile_collection = profile_collection,
        .limit = 2,
        .after = .{
            .created_at_us = first[0].created_at_us,
            .at_uri = first[0].value.record.uri,
        },
    });
    try std.testing.expectEqual(@as(usize, 1), second.len);
    try std.testing.expectEqualStrings("did:plc:listenertwo", second[0].value.actor.did);
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    const name = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(name);
    try row.deinit();
    if (!std.mem.eql(u8, name, "zig_test")) return error.UnsafeTestDatabase;
}
