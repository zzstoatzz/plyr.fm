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
const record_proof_verifier = @import("../projection/record_proof_verifier.zig");
const record_apply = @import("record_apply.zig");

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
    comment: []const u8,

    fn contains(self: Collections, collection: []const u8) bool {
        return std.mem.eql(u8, collection, self.list) or
            std.mem.eql(u8, collection, self.track) or
            std.mem.eql(u8, collection, self.profile) or
            std.mem.eql(u8, collection, self.like) or
            std.mem.eql(u8, collection, self.comment);
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
    const wanted = [_][]const u8{ collections.list, collections.track, collections.profile, collections.like, collections.comment };
    var repositories: pds_source.ZatPdsRepositorySource = .{
        .io = io,
        .identity_resolver = &identity,
        .transport = &repository_transport,
        .collections = &wanted,
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
            .comment_collection = collections.comment,
        },
        .collections = collections,
        .key_cache = &key_cache,
        .repositories = &repositories,
        .watched = &watched,
        .checkpoint = &checkpoint,
        .account_checks = status_checks.port(),
    };
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
    repositories: *pds_source.ZatPdsRepositorySource,
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
            // The event is a hint: what gets projected is the record's state
            // proven by the repo's own PDS at a signed commit.
            .commit => |commit| if (self.collections.contains(commit.collection)) {
                if (self.watched.contains(commit.did))
                    try self.verifyLive(arena.allocator(), commit, event.timeUs(), indexed_at_us)
                else
                    try self.bootstrap(arena.allocator(), commit.did, indexed_at_us);
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
            // The snapshot was fetched after the event, so it already holds it.
            .applied, .idempotent, .stale => try self.watched.add(did),
            // Nothing unverified is projected; the next event retries.
            else => log.warn("bootstrap snapshot for {s} was not applied: {s}", .{ did, @tagName(outcome) }),
        }
    }

    /// Fetch and verify the touched record's `sync.getRecord` proof, then
    /// project that proven state. When no proof can be had, the repository
    /// leaves the watched set so its next event repairs it from a verified
    /// snapshot instead.
    fn verifyLive(
        self: *Handler,
        arena: std.mem.Allocator,
        commit: zat.jetstream.CommitEvent,
        event_us: i64,
        indexed_at_us: i64,
    ) !void {
        if (zat.Rkey.parse(commit.rkey) == null) return;
        const started = std.Io.Timestamp.now(self.io, .awake).nanoseconds;
        const path = try std.fmt.allocPrint(arena, "{s}/{s}", .{ commit.collection, commit.rkey });
        const proof = self.repositories.fetchRecordProof(arena, commit.did, commit.collection, commit.rkey) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return self.unverified(arena, commit.did, path, err, indexed_at_us),
        } orelse return self.unverified(arena, commit.did, path, error.NoRecordProof, indexed_at_us);
        const state = self.verifyProof(arena, commit.did, path, proof) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return self.unverified(arena, commit.did, path, err, indexed_at_us),
        };
        var operation: zat.firehose.RepoOp = .{
            .action = if (state.record == null) .delete else .create,
            .collection = commit.collection,
            .rkey = commit.rkey,
        };
        if (state.record) |record| {
            operation.cid = record.cid;
            operation.record = record.value;
        }
        try record_apply.applyOperation(self.pool, arena, self.collections, commit.did, operation, .{
            .commit_cid = state.commit_cid,
            .commit_rev = state.commit_rev,
            .indexed_at_us = indexed_at_us,
        });
        const verify_ms = @divFloor(std.Io.Timestamp.now(self.io, .awake).nanoseconds - started, std.time.ns_per_ms);
        log.info("live verified {s}/{s} at rev {s}: verify {d}ms, event lag {d}ms", .{
            commit.did,
            path,
            state.commit_rev,
            verify_ms,
            @divFloor(indexed_at_us - event_us, std.time.us_per_ms),
        });
    }

    fn verifyProof(
        self: *Handler,
        arena: std.mem.Allocator,
        did: []const u8,
        path: []const u8,
        proof: []const u8,
    ) !record_proof_verifier.RecordState {
        const keys = self.key_cache.port();
        const key = try keys.resolve(arena, did, false);
        return record_proof_verifier.verifyRecord(arena, proof, path, did, key.publicKey()) catch |err| {
            if (err != error.SignatureVerificationFailed) return err;
            const fresh = try keys.resolve(arena, did, true);
            return record_proof_verifier.verifyRecord(arena, proof, path, did, fresh.publicKey());
        };
    }

    /// No verified state for this event: fall back to a full verified repair
    /// now, and if that fails too, on the repository's next event.
    fn unverified(
        self: *Handler,
        arena: std.mem.Allocator,
        did: []const u8,
        path: []const u8,
        err: anyerror,
        indexed_at_us: i64,
    ) !void {
        log.warn("no verified proof for {s}/{s} ({}); repairing the repository", .{ did, path, err });
        const outcome = try self.projector.repair(arena, did, indexed_at_us);
        switch (outcome) {
            .applied, .idempotent, .stale => {},
            else => {
                self.watched.remove(did);
                log.warn("repair of {s} was not applied: {s}; it repairs on its next event", .{ did, @tagName(outcome) });
            },
        }
    }
};

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
