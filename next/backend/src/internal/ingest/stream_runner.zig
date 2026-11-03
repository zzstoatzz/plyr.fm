//! Jetstream-to-projection ingestion role.
//!
//! The ingester subscribes to jetstream hosts (zat stream first, other
//! jetstream-compatible hosts as failover) filtered to plyr's collections and
//! trusts their upstream signature/MST verification. Each record is checked
//! against the CID the stream reports before it is projected. A repository
//! seen for the first time is bootstrapped once from its PDS (a verified
//! snapshot), which also establishes account availability.
//!
//! The checkpoint is the jetstream `time_us`, which is portable across hosts.
//! An event is accepted only after it is projected; on a projection failure
//! the process exits and its supervisor resumes from the last checkpoint.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const json_record = @import("../atproto/json_record.zig");
const cached_keys = @import("cached_signing_key_resolver.zig");
const cursor_module = @import("relay_cursor.zig");
const postgres_cursor = @import("postgres_relay_cursor.zig");
const projector_module = @import("projector.zig");
const pds_source = @import("zat_pds_repository_source.zig");
const zat_keys = @import("zat_signing_key_resolver.zig");
const watched_module = @import("watched_repositories.zig");
const commit_store = @import("../projection/postgres_verified_commit_store.zig");
const snapshot_store = @import("../projection/postgres_verified_snapshot_store.zig");
const account_schedule = @import("../account/postgres_check_schedule.zig");
const list_change = @import("../projection/list_change.zig");
const track_change = @import("../projection/track_change.zig");
const profile_change = @import("../projection/profile_change.zig");
const like_change = @import("../projection/like_change.zig");
const record_rejection = @import("../projection/record_rejection.zig");
const postgres_list = @import("../projection/postgres_list_store.zig");
const postgres_track = @import("../projection/postgres_track_store.zig");
const postgres_profile = @import("../projection/postgres_profile_store.zig");
const postgres_like = @import("../projection/postgres_like_store.zig");
const postgres_rejections = @import("../projection/postgres_record_rejection_store.zig");

const log = std.log.scoped(.ingester);

/// Checkpoint name in plyr_index.relay_cursors; its value is a time_us.
pub const cursor_source = "jetstream";
/// With no checkpoint yet, start this far back (the deploy's catalog
/// reconciliation covers anything older).
const initial_lookback_us: i64 = 10 * std.time.us_per_min;

pub const Collections = struct {
    list: []const u8,
    track: []const u8,
    profile: []const u8,
    like: []const u8,

    fn contains(self: Collections, collection: []const u8) bool {
        return std.mem.eql(u8, collection, self.list) or
            std.mem.eql(u8, collection, self.track) or
            std.mem.eql(u8, collection, self.profile) or
            std.mem.eql(u8, collection, self.like);
    }
};

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    stream_hosts: []const u8,
    collections: Collections,
) !void {
    const hosts = try parseHosts(allocator, stream_hosts);
    defer allocator.free(hosts);
    var watched = try watched_module.WatchedRepositories.load(allocator, pool);
    defer watched.deinit();

    var cursor_adapter: postgres_cursor.PostgresRelayCursor = .{ .pool = pool };
    const start_us = try nowMicros(io);
    var checkpoint = try cursor_module.Checkpoint.init(cursor_adapter.store(), cursor_source, start_us);

    var identity = zat.DidResolver.init(io, allocator);
    defer identity.deinit();
    identity.transport.user_agent = "plyr.fm-zig-ingester/0.1 (+https://plyr.fm)";
    var repository_transport = zat.HttpTransport.initWithUserAgent(
        io,
        allocator,
        "plyr.fm-zig-ingester/0.1 (+https://plyr.fm)",
    );
    defer repository_transport.deinit();
    var key_upstream: zat_keys.ZatSigningKeyResolver = .{ .resolver = &identity };
    var key_cache = cached_keys.CachedSigningKeyResolver.init(allocator, io, 1024, key_upstream.port());
    defer key_cache.deinit();
    var repositories: pds_source.ZatPdsRepositorySource = .{
        .io = io,
        .identity_resolver = &identity,
        .transport = &repository_transport,
    };
    var commits: commit_store.PostgresVerifiedCommitStore = .{ .pool = pool };
    var snapshots: snapshot_store.PostgresVerifiedSnapshotStore = .{ .pool = pool };
    var status_checks: account_schedule.PostgresCheckSchedule = .{ .pool = pool };

    var handler: Handler = .{
        .allocator = allocator,
        .io = io,
        .pool = pool,
        .projector = .{
            .heads = commits.reader(),
            .commits = commits.store(),
            .snapshots = snapshots.store(),
            .keys = key_cache.port(),
            .repositories = repositories.port(),
            .list_collection = collections.list,
            .track_collection = collections.track,
            .profile_collection = collections.profile,
            .like_collection = collections.like,
        },
        .collections = collections,
        .key_cache = &key_cache,
        .watched = &watched,
        .checkpoint = &checkpoint,
        .account_checks = status_checks.port(),
    };
    const wanted = [_][]const u8{ collections.list, collections.track, collections.profile, collections.like };
    const cursor = checkpoint.persisted orelse start_us - initial_lookback_us;
    var client = zat.JetstreamClient.init(io, allocator, .{
        .hosts = hosts,
        .wanted_collections = &wanted,
        .cursor = cursor,
    });
    defer client.deinit();
    log.info("starting jetstream ingestion from {s} at time_us {d} for {d} watched repositories", .{
        hosts[0],
        cursor,
        watched.count(),
    });
    try client.subscribe(&handler);
}

const Handler = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    pool: *pg.Pool,
    projector: projector_module.Projector,
    collections: Collections,
    key_cache: *cached_keys.CachedSigningKeyResolver,
    watched: *watched_module.WatchedRepositories,
    checkpoint: *cursor_module.Checkpoint,
    account_checks: @import("../account/check_schedule.zig").Schedule,

    pub fn onEvent(self: *Handler, event: zat.JetstreamEvent) void {
        self.process(event) catch |err| {
            log.err("jetstream event at time_us {d} was not projected: {}; exiting to resume from the checkpoint", .{
                event.timeUs(),
                err,
            });
            std.process.exit(1);
        };
    }

    pub fn onConnect(_: *Handler, host: []const u8) void {
        log.info("jetstream connection established: {s}", .{host});
    }

    pub fn onError(_: *Handler, err: anyerror) void {
        log.warn("jetstream transport failed: {}", .{err});
    }

    fn process(self: *Handler, event: zat.JetstreamEvent) !void {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const indexed_at_us = try nowMicros(self.io);
        switch (event) {
            .commit => |commit| if (self.collections.contains(commit.collection)) {
                if (!self.watched.contains(commit.did))
                    try self.bootstrap(arena.allocator(), commit.did, indexed_at_us);
                try applyCommit(self.pool, arena.allocator(), self.collections, commit, indexed_at_us);
            },
            .identity => |identity| self.key_cache.evict(identity.did),
            // A low-latency hint only: a separately supervised worker checks
            // the account's current DID document and PDS.
            .account => |account| if (self.watched.contains(account.did))
                self.account_checks.hint(account.did, indexed_at_us) catch |err|
                    log.warn("account status hint for {s} was not recorded: {}", .{ account.did, err }),
        }
        try self.checkpoint.accept(event.timeUs(), indexed_at_us);
    }

    fn bootstrap(self: *Handler, allocator: std.mem.Allocator, did: []const u8, indexed_at_us: i64) !void {
        const outcome = try self.projector.repair(allocator, did, indexed_at_us);
        switch (outcome) {
            .applied, .idempotent, .stale => try self.watched.add(did),
            // The event itself is still projected; the next event retries.
            else => log.warn("bootstrap snapshot for {s} was not applied: {s}", .{ did, @tagName(outcome) }),
        }
    }
};

pub const ApplyError = error{
    OutOfMemory,
    InvalidStreamEvent,
    ProjectionUnavailable,
    CorruptProjection,
    RevisionConflict,
};

/// Project one jetstream commit operation. A record that fails its schema is
/// recorded as a rejection and removed from the projection, as for any record.
pub fn applyCommit(
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

    var change: Change = undefined;
    var rejections: [1]record_rejection.Rejection = undefined;
    var rejected: []const record_rejection.Rejection = &.{};
    build: {
        const built = buildChange(arena, collections, commit.did, operation, proof) catch |err| {
            if (err == error.OutOfMemory) return error.OutOfMemory;
            const record_cid = operation.cid orelse return error.InvalidStreamEvent;
            rejections[0] = record_rejection.init(
                arena,
                commit.did,
                commit.collection,
                commit.rkey,
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
    const uri = try std.fmt.allocPrint(arena, "at://{s}/{s}/{s}", .{ commit.did, commit.collection, commit.rkey });
    switch (change) {
        inline else => |value, tag| {
            var store = storeFor(tag, pool);
            _ = store.applyInTransaction(conn, arena, value) catch |err| return mapStoreError(err);
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

fn parseHosts(allocator: std.mem.Allocator, encoded: []const u8) ![]const []const u8 {
    var hosts: std.ArrayList([]const u8) = .empty;
    errdefer hosts.deinit(allocator);
    var parts = std.mem.splitScalar(u8, encoded, ',');
    while (parts.next()) |raw| {
        const host = std.mem.trim(u8, raw, " \t\r\n");
        if (host.len == 0 or std.mem.indexOfAny(u8, host, ":/ ") != null)
            return error.InvalidStreamHosts;
        try hosts.append(allocator, host);
    }
    if (hosts.items.len == 0) return error.InvalidStreamHosts;
    return hosts.toOwnedSlice(allocator);
}

fn nowMicros(io: std.Io) !i64 {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse
        error.InvalidSystemClock;
}

test "stream hosts are bare hostnames" {
    const hosts = try parseHosts(std.testing.allocator, "stream.waow.tech, jetstream1.us-east.bsky.network");
    defer std.testing.allocator.free(hosts);
    try std.testing.expectEqual(@as(usize, 2), hosts.len);
    try std.testing.expectEqualStrings("jetstream1.us-east.bsky.network", hosts[1]);
    try std.testing.expectError(error.InvalidStreamHosts, parseHosts(std.testing.allocator, "wss://bsky.network"));
    try std.testing.expectError(error.InvalidStreamHosts, parseHosts(std.testing.allocator, ""));
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
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
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
        .time_us = 3,
        .rev = &rev_3,
        .operation = .delete,
        .collection = collections.profile,
        .rkey = "self",
    }, 13);
    try expectProfile(pool, null, true, 0);
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
