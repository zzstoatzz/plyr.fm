//! One-shot authenticated repository bootstrap/repair process role.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const cached_keys = @import("cached_signing_key_resolver.zig");
const projector_module = @import("projector.zig");
const pds_source = @import("zat_pds_repository_source.zig");
const zat_keys = @import("zat_signing_key_resolver.zig");
const commit_store = @import("../projection/postgres_verified_commit_store.zig");
const snapshot_store = @import("../projection/postgres_verified_snapshot_store.zig");

pub const Error = projector_module.Error || error{InvalidSystemClock};

pub const Runner = struct {
    io: std.Io,
    identity: zat.DidResolver,
    repository_transport: zat.HttpTransport,
    key_upstream: zat_keys.ZatSigningKeyResolver,
    key_cache: cached_keys.CachedSigningKeyResolver,
    repositories: pds_source.ZatPdsRepositorySource,
    commits: commit_store.PostgresVerifiedCommitStore,
    snapshots: snapshot_store.PostgresVerifiedSnapshotStore,
    projector: projector_module.Projector,

    pub fn init(
        self: *Runner,
        io: std.Io,
        allocator: std.mem.Allocator,
        pool: *pg.Pool,
        list_collection: []const u8,
        track_collection: []const u8,
        profile_collection: []const u8,
    ) void {
        self.io = io;
        self.identity = zat.DidResolver.init(io, allocator);
        self.identity.transport.user_agent = "plyr.fm-zig-ingester/0.1 (+https://plyr.fm)";
        self.repository_transport = zat.HttpTransport.initWithUserAgent(
            io,
            allocator,
            "plyr.fm-zig-ingester/0.1 (+https://plyr.fm)",
        );
        self.key_upstream = .{ .resolver = &self.identity };
        self.key_cache = cached_keys.CachedSigningKeyResolver.init(
            allocator,
            io,
            1024,
            self.key_upstream.port(),
        );
        self.repositories = .{
            .io = io,
            .identity_resolver = &self.identity,
            .transport = &self.repository_transport,
        };
        self.commits = .{ .pool = pool };
        self.snapshots = .{ .pool = pool };
        self.projector = .{
            .heads = self.commits.reader(),
            .commits = self.commits.store(),
            .snapshots = self.snapshots.store(),
            .keys = self.key_cache.port(),
            .repositories = self.repositories.port(),
            .list_collection = list_collection,
            .track_collection = track_collection,
            .profile_collection = profile_collection,
        };
    }

    pub fn deinit(self: *Runner) void {
        self.key_cache.deinit();
        self.repository_transport.deinit();
        self.identity.deinit();
    }

    pub fn repair(
        self: *Runner,
        allocator: std.mem.Allocator,
        did: []const u8,
    ) Error!projector_module.RepairOutcome {
        const now = std.Io.Timestamp.now(self.io, .real).nanoseconds;
        if (now < 0) return error.InvalidSystemClock;
        const indexed_at_us = std.math.cast(i64, @divFloor(now, 1000)) orelse
            return error.InvalidSystemClock;
        return self.projector.repair(allocator, did, indexed_at_us);
    }
};

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    did: []const u8,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
) !projector_module.RepairOutcome {
    var runner: Runner = undefined;
    runner.init(
        io,
        allocator,
        pool,
        list_collection,
        track_collection,
        profile_collection,
    );
    defer runner.deinit();
    return runner.repair(allocator, did);
}

pub fn succeeded(outcome: projector_module.RepairOutcome) bool {
    return switch (outcome) {
        .applied, .idempotent, .stale => true,
        else => false,
    };
}

test "only durable repair dispositions are successful process outcomes" {
    try std.testing.expect(succeeded(.applied));
    try std.testing.expect(succeeded(.idempotent));
    try std.testing.expect(succeeded(.stale));
    try std.testing.expect(!succeeded(.invalid_signature));
    try std.testing.expect(!succeeded(.unsafe_endpoint));
    try std.testing.expect(!succeeded(.unavailable));
}
