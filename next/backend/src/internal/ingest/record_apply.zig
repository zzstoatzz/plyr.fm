//! Project one authenticated record operation into the index, in one
//! transaction with its rejection bookkeeping.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const json_record = @import("../atproto/json_record.zig");
const list_change = @import("../projection/list_change.zig");
const track_change = @import("../projection/track_change.zig");
const profile_change = @import("../projection/profile_change.zig");
const like_change = @import("../projection/like_change.zig");
const record_rejection = @import("../projection/record_rejection.zig");
const postgres_list = @import("../projection/postgres_list_store.zig");
const postgres_track = @import("../projection/postgres_track_store.zig");
const postgres_profile = @import("../projection/postgres_profile_store.zig");
const postgres_like = @import("../projection/postgres_like_store.zig");
const repository_lock = @import("../projection/postgres_repository_lock.zig");
const postgres_rejections = @import("../projection/postgres_record_rejection_store.zig");
const Collections = @import("stream_runner.zig").Collections;

const log = std.log.scoped(.ingester);

pub const ApplyError = error{
    OutOfMemory,
    InvalidStreamEvent,
    ProjectionUnavailable,
    CorruptProjection,
    RevisionConflict,
};

/// Test fixture path: project a jetstream commit's own record (self-certified
/// by its CID only). Live ingestion projects proven state via `verifyLive`.
fn applyCommit(
    pool: *pg.Pool,
    arena: std.mem.Allocator,
    collections: Collections,
    commit: zat.jetstream.CommitEvent,
    indexed_at_us: i64,
) ApplyError!void {
    const rev = commit.rev orelse return error.InvalidStreamEvent;
    if (zat.Tid.parse(rev) == null or zat.Did.parse(commit.did) == null)
        return error.InvalidStreamEvent;
    var operation: zat.firehose.RepoOp = .{
        .action = commit.operation,
        .collection = commit.collection,
        .rkey = commit.rkey,
    };
    if (commit.operation != .delete) {
        const record = commit.record orelse return error.InvalidStreamEvent;
        const cid_text = commit.cid orelse return error.InvalidStreamEvent;
        const checked = json_record.verified(arena, record, cid_text) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.InvalidRecord, error.RecordCidMismatch => {
                // Nothing trustworthy to project; leave the record as it was.
                log.warn("skipping {s}/{s}/{s} at rev {s}: {}", .{ commit.did, commit.collection, commit.rkey, rev, err });
                return;
            },
        };
        operation.record = checked.value;
        operation.cid = checked.cid;
    }
    const proof: list_change.Proof = .{ .commit_cid = null, .commit_rev = rev, .indexed_at_us = indexed_at_us };
    return applyOperation(pool, arena, collections, commit.did, operation, proof);
}

/// Project one authenticated record operation. A record that fails its schema
/// is recorded as a rejection and removed from the projection, as for any
/// record.
pub fn applyOperation(
    pool: *pg.Pool,
    arena: std.mem.Allocator,
    collections: Collections,
    did: []const u8,
    operation: zat.firehose.RepoOp,
    proof: list_change.Proof,
) ApplyError!void {
    var change: Change = undefined;
    var rejections: [1]record_rejection.Rejection = undefined;
    var rejected: []const record_rejection.Rejection = &.{};
    build: {
        const built = buildChange(arena, collections, did, operation, proof) catch |err| {
            if (err == error.OutOfMemory) return error.OutOfMemory;
            const record_cid = operation.cid orelse return error.InvalidStreamEvent;
            rejections[0] = record_rejection.init(
                arena,
                did,
                operation.collection,
                operation.rkey,
                record_cid,
                .invalid_schema,
                @errorName(err),
                proof,
            ) catch return error.OutOfMemory;
            rejected = rejections[0..1];
            change = deletionFor(collections, rejections[0]);
            break :build;
        } orelse return;
        change = built;
    }

    var conn = pool.acquire() catch return error.ProjectionUnavailable;
    defer pool.release(conn);
    conn.begin() catch return error.ProjectionUnavailable;
    var open = true;
    defer if (open) conn.rollback() catch {};
    repository_lock.acquire(conn, did) catch return error.ProjectionUnavailable;
    const uri = try std.fmt.allocPrint(arena, "at://{s}/{s}/{s}", .{ did, operation.collection, operation.rkey });
    switch (change) {
        inline else => |value, tag| {
            var store = storeFor(tag, pool);
            const result = store.applyInTransaction(conn, arena, value) catch |err| return mapStoreError(err);
            if (result == .stale) return;
        },
    }
    var rejection_store: postgres_rejections.PostgresRecordRejectionStore = .{ .pool = pool };
    rejection_store.replaceForCommit(conn, arena, &.{uri}, rejected) catch |err| return switch (err) {
        error.OutOfMemory => error.OutOfMemory,
        error.ProjectionUnavailable => error.ProjectionUnavailable,
        error.RevisionConflict => error.RevisionConflict,
        error.InvalidRejection, error.CorruptProjection => error.CorruptProjection,
    };
    conn.commit() catch return error.ProjectionUnavailable;
    open = false;
}

const Change = union(enum) {
    list: list_change.Change,
    track: track_change.Change,
    profile: profile_change.Change,
    like: like_change.Change,
};

fn buildChange(
    arena: std.mem.Allocator,
    collections: Collections,
    did: []const u8,
    operation: zat.firehose.RepoOp,
    proof: list_change.Proof,
) !?Change {
    const collection = operation.collection;
    if (std.mem.eql(u8, collection, collections.list))
        return .{ .list = (try list_change.fromVerifiedOperation(arena, did, operation, collections.list, collections.track, proof)) orelse return null };
    if (std.mem.eql(u8, collection, collections.track))
        return .{ .track = (try track_change.fromVerifiedOperation(arena, did, operation, collections.track, proof)) orelse return null };
    if (std.mem.eql(u8, collection, collections.profile))
        return .{ .profile = (try profile_change.fromVerifiedOperation(arena, did, operation, collections.profile, proof)) orelse return null };
    if (std.mem.eql(u8, collection, collections.like))
        return .{ .like = (try like_change.fromVerifiedOperation(arena, did, operation, collections.like, collections.track, proof)) orelse return null };
    return null;
}

fn deletionFor(collections: Collections, rejection: record_rejection.Rejection) Change {
    if (std.mem.eql(u8, rejection.collection, collections.list)) return .{ .list = rejection.listDelete() };
    if (std.mem.eql(u8, rejection.collection, collections.track)) return .{ .track = rejection.trackDelete() };
    if (std.mem.eql(u8, rejection.collection, collections.profile)) return .{ .profile = rejection.profileDelete() };
    return .{ .like = rejection.likeDelete() };
}

fn storeFor(comptime tag: std.meta.Tag(Change), pool: *pg.Pool) switch (tag) {
    .list => postgres_list.PostgresListStore,
    .track => postgres_track.PostgresTrackStore,
    .profile => postgres_profile.PostgresProfileStore,
    .like => postgres_like.PostgresLikeStore,
} {
    return .{ .pool = pool };
}

fn mapStoreError(err: anyerror) ApplyError {
    return switch (err) {
        error.OutOfMemory => error.OutOfMemory,
        error.RevisionConflict => error.RevisionConflict,
        error.CorruptProjection => error.CorruptProjection,
        else => error.ProjectionUnavailable,
    };
}

test "PostgreSQL stream commits project, replay, reject and delete profile records" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 2 });
    defer pool.deinit();
    {
        var row = (try pool.row("SELECT current_database()", .{})).?;
        defer row.deinit() catch {};
        if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
    }
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try postgres_profile.createTestTable(pool);
    try postgres_rejections.createTestTable(pool);

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const collections: Collections = .{
        .list = "fm.plyr.dev.list",
        .track = "fm.plyr.dev.track",
        .profile = "fm.plyr.dev.actor.profile",
        .like = "fm.plyr.dev.like",
    };
    const rev_1 = zat.Tid.fromTimestamp(1_000, 1).str();
    const rev_2 = zat.Tid.fromTimestamp(2_000, 1).str();
    const rev_3 = zat.Tid.fromTimestamp(3_000, 1).str();

    const created = try streamRecord(arena, "{\"$type\":\"fm.plyr.dev.actor.profile\",\"bio\":\"hi\",\"displayName\":\"stg nate\",\"createdAt\":\"2026-11-03T00:00:00Z\"}");
    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 1,
        .rev = &rev_1,
        .operation = .create,
        .collection = collections.profile,
        .rkey = "self",
        .record = created.json,
        .cid = created.cid,
    }, 10);
    // A replay after a host switch is a no-op.
    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 1,
        .rev = &rev_1,
        .operation = .create,
        .collection = collections.profile,
        .rkey = "self",
        .record = created.json,
        .cid = created.cid,
    }, 11);
    try expectProfile(pool, "stg nate", false, 0);

    // A record whose JSON doesn't hash to the reported CID is skipped.
    const other = try streamRecord(arena, "{\"$type\":\"fm.plyr.dev.actor.profile\",\"bio\":\"changed\",\"createdAt\":\"2026-11-03T00:00:00Z\"}");
    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 2,
        .rev = &rev_2,
        .operation = .update,
        .collection = collections.profile,
        .rkey = "self",
        .record = other.json,
        .cid = created.cid,
    }, 12);
    try expectProfile(pool, "stg nate", false, 0);

    // A schema-invalid update removes the record and records why.
    const invalid = try streamRecord(arena, "{\"$type\":\"fm.plyr.dev.actor.profile\",\"avatar\":\"not a uri\",\"createdAt\":\"2026-11-03T00:00:00Z\"}");
    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 2,
        .rev = &rev_2,
        .operation = .update,
        .collection = collections.profile,
        .rkey = "self",
        .record = invalid.json,
        .cid = invalid.cid,
    }, 12);
    try expectProfile(pool, null, true, 1);
    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 1,
        .rev = &rev_1,
        .operation = .create,
        .collection = collections.profile,
        .rkey = "self",
        .record = created.json,
        .cid = created.cid,
    }, 14);
    try expectProfile(pool, null, true, 1);
    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 1,
        .rev = &rev_1,
        .operation = .update,
        .collection = collections.profile,
        .rkey = "self",
        .record = invalid.json,
        .cid = invalid.cid,
    }, 15);
    {
        var row = (try pool.row("SELECT commit_rev FROM plyr_index.record_rejections", .{})).?;
        defer row.deinit() catch {};
        try std.testing.expectEqualStrings(&rev_2, try row.get([]const u8, 0));
    }

    try applyCommit(pool, arena, collections, .{
        .did = "did:plc:artist",
        .time_us = 3,
        .rev = &rev_3,
        .operation = .delete,
        .collection = collections.profile,
        .rkey = "self",
    }, 13);
    try expectProfile(pool, null, true, 0);
    try expectRepairSerializesLive(pool, io, collections, created.json, created.cid, &rev_3);
}

fn expectRepairSerializesLive(pool: *pg.Pool, io: std.Io, collections: Collections, record: std.json.Value, cid: []const u8, rev: []const u8) !void {
    const Worker = struct {
        pool: *pg.Pool,
        collections: Collections,
        record: std.json.Value,
        cid: []const u8,
        rev: []const u8,
        done: std.atomic.Value(bool) = .init(false),
        failure: ?anyerror = null,

        fn run(self: *@This()) void {
            defer self.done.store(true, .release);
            var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
            defer arena.deinit();
            self.execute(arena.allocator()) catch |err| {
                self.failure = err;
            };
        }

        fn execute(self: *@This(), a: std.mem.Allocator) !void {
            _ = try self.pool.exec("SET application_name = 'plyr_zig_live_lock_test'", .{});
            try applyCommit(self.pool, a, self.collections, .{
                .did = "did:plc:locked",
                .time_us = 1,
                .rev = self.rev,
                .operation = .create,
                .collection = self.collections.profile,
                .rkey = "self",
                .record = self.record,
                .cid = self.cid,
            }, 100);
        }
    };
    const conn = try pool.acquire();
    defer pool.release(conn);
    try conn.begin();
    var open = true;
    var lock_row = (try conn.row("SELECT pg_advisory_xact_lock(hashtextextended($1, 1881820018))", .{"did:plc:locked"})).?;
    try lock_row.deinit();
    var worker: Worker = .{ .pool = pool, .collections = collections, .record = record, .cid = cid, .rev = rev };
    const thread = try std.Thread.spawn(.{}, Worker.run, .{&worker});
    var joined = false;
    defer {
        if (open) conn.rollback() catch {};
        if (!joined) thread.join();
    }
    var blocked = false;
    for (0..500) |_| {
        _ = try conn.exec("SELECT pg_stat_clear_snapshot()", .{});
        var row = (try conn.row("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'plyr_zig_live_lock_test' AND wait_event = 'advisory')", .{})).?;
        blocked = try row.get(bool, 0);
        try row.deinit();
        if (blocked or worker.done.load(.acquire)) break;
        try io.sleep(std.Io.Duration.fromMilliseconds(10), .awake);
    }
    try conn.rollback();
    open = false;
    thread.join();
    joined = true;
    if (worker.failure) |err| return err;
    try std.testing.expect(blocked);
    var row = (try conn.row("SELECT NOT deleted FROM plyr_index.profile_records WHERE owner_did = 'did:plc:locked'", .{})).?;
    defer row.deinit() catch {};
    try std.testing.expect(try row.get(bool, 0));
}

fn streamRecord(arena: std.mem.Allocator, text: []const u8) !struct { json: std.json.Value, cid: []const u8 } {
    const value = try std.json.parseFromSliceLeaky(std.json.Value, arena, text, .{});
    const encoded = try zat.cbor.encodeAlloc(arena, try json_record.toCbor(arena, value));
    return .{ .json = value, .cid = try (try zat.Cid.forDagCbor(arena, encoded)).toString(arena) };
}

fn expectProfile(pool: *pg.Pool, display_name: ?[]const u8, deleted: bool, rejections: i64) !void {
    var row = (try pool.row(
        \\SELECT p.display_name, p.deleted, p.commit_cid IS NULL,
        \\  (SELECT count(*) FROM plyr_index.record_rejections)
        \\FROM plyr_index.profile_records AS p
    , .{})).?;
    defer row.deinit() catch {};
    const name = try row.get(?[]const u8, 0);
    if (display_name) |expected| try std.testing.expectEqualStrings(expected, name.?) else try std.testing.expect(name == null);
    try std.testing.expectEqual(deleted, try row.get(bool, 1));
    try std.testing.expect(try row.get(bool, 2));
    try std.testing.expectEqual(rejections, try row.get(i64, 3));
}
