//! Separately supervised, signed relay-to-projection ingestion role.
//!
//! The raw-frame callback is deliberately fallible. Zat advances its reconnect
//! cursor only after this handler has accepted the frame, and this handler
//! accepts a sequence only after projection or authoritative repair succeeds.

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

const log = std.log.scoped(.ingester);

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    relay_hosts: []const u8,
    relay_name: []const u8,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
) !void {
    const hosts = try parseHosts(allocator, relay_hosts);
    defer allocator.free(hosts);
    var watched = try watched_module.WatchedRepositories.load(allocator, pool);
    defer watched.deinit();

    var cursor_adapter: postgres_cursor.PostgresRelayCursor = .{ .pool = pool };
    const start_us = try nowMicros(io);
    var checkpoint = try cursor_module.Checkpoint.init(
        cursor_adapter.store(),
        relay_name,
        start_us,
    );

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
    var key_cache = cached_keys.CachedSigningKeyResolver.init(
        allocator,
        io,
        1024,
        key_upstream.port(),
    );
    defer key_cache.deinit();
    var repositories: pds_source.ZatPdsRepositorySource = .{
        .io = io,
        .identity_resolver = &identity,
        .transport = &repository_transport,
    };
    var commits: commit_store.PostgresVerifiedCommitStore = .{ .pool = pool };
    var snapshots: snapshot_store.PostgresVerifiedSnapshotStore = .{ .pool = pool };
    var status_checks: account_schedule.PostgresCheckSchedule = .{ .pool = pool };
    const projector: projector_module.Projector = .{
        .heads = commits.reader(),
        .commits = commits.store(),
        .snapshots = snapshots.store(),
        .keys = key_cache.port(),
        .repositories = repositories.port(),
        .list_collection = list_collection,
        .track_collection = track_collection,
        .profile_collection = profile_collection,
        .like_collection = like_collection,
    };

    var handler: Handler = .{
        .allocator = allocator,
        .io = io,
        .projector = projector,
        .key_cache = &key_cache,
        .watched = &watched,
        .checkpoint = &checkpoint,
        .list_collection = list_collection,
        .track_collection = track_collection,
        .profile_collection = profile_collection,
        .like_collection = like_collection,
        .account_checks = status_checks.port(),
    };
    var client = zat.FirehoseClient.init(io, allocator, .{
        .hosts = hosts,
        .cursor = checkpoint.persisted,
    });
    defer client.deinit();
    log.info("starting {s} relay ingestion at cursor {?d} for {d} watched repositories", .{
        relay_name,
        checkpoint.persisted,
        watched.count(),
    });
    try client.subscribe(&handler);
    try checkpoint.flush(try nowMicros(io));
    if (handler.fatal_error) |err| return err;
}

const Handler = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    projector: projector_module.Projector,
    key_cache: *cached_keys.CachedSigningKeyResolver,
    watched: *watched_module.WatchedRepositories,
    checkpoint: *cursor_module.Checkpoint,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    account_checks: @import("../account/check_schedule.zig").Schedule,
    fatal_error: ?anyerror = null,

    pub fn onRawFrame(self: *Handler, frame: []const u8) !void {
        self.processFrame(frame) catch |err| {
            self.fatal_error = err;
            log.err("rejecting relay frame before cursor acceptance: {}", .{err});
            return err;
        };
    }

    pub fn shouldStop(self: *Handler) bool {
        return self.fatal_error != null;
    }

    pub fn onConnect(_: *Handler, host: []const u8) void {
        log.info("relay connection established: {s}", .{host});
    }

    pub fn onReconnect(_: *Handler) void {
        log.warn("reconnecting relay subscription", .{});
    }

    pub fn onError(_: *Handler, err: anyerror) void {
        log.warn("relay transport failed: {}", .{err});
    }

    fn processFrame(self: *Handler, frame: []const u8) !void {
        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const event = zat.firehose.decodeFrame(arena.allocator(), frame) catch
            return error.InvalidRelayFrame;
        const indexed_at_us = try nowMicros(self.io);
        switch (event) {
            .commit => |commit| try self.processCommit(arena.allocator(), commit, indexed_at_us),
            .sync => |sync| if (self.watched.contains(sync.did))
                try self.repairAndWatch(arena.allocator(), sync.did, indexed_at_us),
            .identity => |identity| self.key_cache.evict(identity.did),
            // Relay state is only a low-latency hint. A separately supervised
            // worker resolves the current DID document and checks its PDS;
            // periodic seeding makes this best-effort write non-authoritative.
            .account => |account| if (self.watched.contains(account.did))
                self.account_checks.hint(account.did, indexed_at_us) catch |err|
                    log.warn("account status hint for {s} was not recorded: {}", .{ account.did, err }),
            .info => |info| if (info.name) |name| {
                if (std.mem.eql(u8, name, "OutdatedCursor"))
                    return error.OutdatedRelayCursor;
            },
        }
        if (event.seq()) |seq| try self.checkpoint.accept(seq, indexed_at_us);
    }

    fn processCommit(
        self: *Handler,
        allocator: std.mem.Allocator,
        commit: zat.firehose.CommitEvent,
        indexed_at_us: i64,
    ) !void {
        if (!self.watched.contains(commit.repo)) {
            if (!hasRelevantOperation(
                commit,
                self.list_collection,
                self.track_collection,
                self.profile_collection,
                self.like_collection,
            )) return;
            return self.repairAndWatch(allocator, commit.repo, indexed_at_us);
        }
        const outcome = try self.projector.ingestLive(allocator, commit, indexed_at_us);
        switch (outcome) {
            .applied, .idempotent, .replay => {},
            .needs_bootstrap, .needs_repair => try self.repairAndWatch(allocator, commit.repo, indexed_at_us),
            .unverified_identity => return error.UnverifiedRepositoryIdentity,
            .invalid_signature => return error.InvalidRepositorySignature,
            .invalid_commit => return error.InvalidRepositoryCommit,
        }
    }

    fn repairAndWatch(
        self: *Handler,
        allocator: std.mem.Allocator,
        did: []const u8,
        indexed_at_us: i64,
    ) !void {
        const outcome = try self.projector.repair(allocator, did, indexed_at_us);
        switch (outcome) {
            .applied, .idempotent, .stale => try self.watched.add(did),
            else => {
                log.err("authoritative repair for {s} rejected: {s}", .{ did, @tagName(outcome) });
                return error.RepositoryRepairRejected;
            },
        }
    }
};

fn hasRelevantOperation(
    commit: zat.firehose.CommitEvent,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
) bool {
    for (commit.ops) |operation| {
        if (std.mem.eql(u8, operation.collection, list_collection) or
            std.mem.eql(u8, operation.collection, track_collection) or
            std.mem.eql(u8, operation.collection, profile_collection) or
            std.mem.eql(u8, operation.collection, like_collection)) return true;
    }
    return false;
}

fn parseHosts(allocator: std.mem.Allocator, encoded: []const u8) ![]const []const u8 {
    var hosts: std.ArrayList([]const u8) = .empty;
    errdefer hosts.deinit(allocator);
    var parts = std.mem.splitScalar(u8, encoded, ',');
    while (parts.next()) |raw| {
        const host = std.mem.trim(u8, raw, " \t\r\n");
        if (host.len == 0) return error.InvalidRelayHosts;
        _ = zat.firehose.Endpoint.parse(host) catch return error.InvalidRelayHosts;
        try hosts.append(allocator, host);
    }
    if (hosts.items.len == 0) return error.InvalidRelayHosts;
    return hosts.toOwnedSlice(allocator);
}

fn nowMicros(io: std.Io) !i64 {
    const nanoseconds = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (nanoseconds < 0) return error.InvalidSystemClock;
    return std.math.cast(i64, @divFloor(nanoseconds, 1000)) orelse
        error.InvalidSystemClock;
}

test "unknown repositories become interesting only through selected collections" {
    const relevant = [_]zat.firehose.RepoOp{.{
        .action = .create,
        .collection = "fm.plyr.list",
        .rkey = "one",
    }};
    const unrelated = [_]zat.firehose.RepoOp{.{
        .action = .create,
        .collection = "app.bsky.feed.post",
        .rkey = "one",
    }};
    const base: zat.firehose.CommitEvent = .{
        .seq = 1,
        .repo = "did:plc:a",
        .rev = "3jqfcqzm3fo2j",
        .time = "2026-08-08T00:00:00Z",
        .ops = &relevant,
    };
    try std.testing.expect(hasRelevantOperation(
        base,
        "fm.plyr.list",
        "fm.plyr.track",
        "fm.plyr.actor.profile",
        "fm.plyr.like",
    ));
    var other = base;
    other.ops = &unrelated;
    try std.testing.expect(!hasRelevantOperation(
        other,
        "fm.plyr.list",
        "fm.plyr.track",
        "fm.plyr.actor.profile",
        "fm.plyr.like",
    ));
}

test "relay host parsing is explicit and rejects ambiguous entries" {
    const hosts = try parseHosts(std.testing.allocator, "wss://one.example, ws://two.example:80");
    defer std.testing.allocator.free(hosts);
    try std.testing.expectEqual(@as(usize, 2), hosts.len);
    try std.testing.expectError(error.InvalidRelayHosts, parseHosts(std.testing.allocator, ""));
    try std.testing.expectError(
        error.InvalidRelayHosts,
        parseHosts(std.testing.allocator, "https://not-a-websocket.example"),
    );
}
