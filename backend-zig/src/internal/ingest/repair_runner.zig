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

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    did: []const u8,
    list_collection: []const u8,
    track_collection: []const u8,
) !projector_module.RepairOutcome {
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
    const projector: projector_module.Projector = .{
        .heads = commits.reader(),
        .commits = commits.store(),
        .snapshots = snapshots.store(),
        .keys = key_cache.port(),
        .repositories = repositories.port(),
        .list_collection = list_collection,
        .track_collection = track_collection,
    };
    const now = std.Io.Timestamp.now(io, .real).nanoseconds;
    if (now < 0) return error.InvalidSystemClock;
    const indexed_at_us = std.math.cast(i64, @divFloor(now, 1000)) orelse
        return error.InvalidSystemClock;
    return projector.repair(allocator, did, indexed_at_us);
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
