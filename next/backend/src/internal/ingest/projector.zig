//! Authoritative repository repair: fetch, verify and apply a full snapshot.
//!
//! Transport outcomes are explicit. No branch converts unavailable identity,
//! an invalid signature, or an incomplete repository into projected data.

const std = @import("std");
const builtin = @import("builtin");
const zat = @import("zat");
const repository_source = @import("repository_source.zig");
const signing_key = @import("signing_key.zig");
const repository_head = @import("../projection/repository_head.zig");
const snapshot_verifier = @import("../projection/snapshot_verifier.zig");
const verified_commit = @import("../projection/verified_commit.zig");
const verified_snapshot = @import("../projection/verified_snapshot.zig");

const log = std.log.scoped(.projector);

pub const Projector = struct {
    heads: repository_head.Reader,
    commits: verified_commit.Store,
    snapshots: verified_snapshot.Store,
    keys: signing_key.Resolver,
    repositories: repository_source.Source,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,

    const verifyFetched = verifyFetchedImpl;

    pub fn repair(
        self: Projector,
        allocator: std.mem.Allocator,
        did: []const u8,
        indexed_at_us: i64,
    ) Error!RepairOutcome {
        if (zat.Did.parse(did) == null or indexed_at_us < 0) return .invalid_repository;
        var key = self.keys.resolve(allocator, did, false) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return .unverified_identity,
        };
        const fetched = self.repositories.fetch(allocator, did) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.RepositoryNotFound => return .not_found,
            error.RepositoryRateLimited => return .rate_limited,
            error.RepositoryUnavailable => return .unavailable,
            error.RepositoryTooLarge => return .too_large,
            error.RepositoryIdentityUnavailable => return .unverified_identity,
            error.RepositoryEndpointMissing => return .endpoint_missing,
            error.UnsafeRepositoryEndpoint => return .unsafe_endpoint,
            error.UnsupportedRepositoryEndpoint => return .unsupported_endpoint,
            error.InvalidIdentity, error.EmptyRepository => return .invalid_repository,
        };
        defer fetched.release();

        const snapshot = self.verifyFetched(allocator, fetched, did, key.publicKey(), indexed_at_us) catch |first_error| blk: {
            if (first_error != error.SignatureVerificationFailed) {
                if (!builtin.is_test)
                    log.warn("repository snapshot for {s} was rejected: {}", .{ did, first_error });
                return classifySnapshotVerification(first_error);
            }
            key = self.keys.resolve(allocator, did, true) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return .unverified_identity,
            };
            break :blk self.verifyFetched(allocator, fetched, did, key.publicKey(), indexed_at_us) catch |second_error| {
                if (!builtin.is_test)
                    log.warn("repository snapshot for {s} was rejected after key refresh: {}", .{ did, second_error });
                return classifySnapshotVerification(second_error);
            };
        };
        const result = self.snapshots.apply(allocator, snapshot) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.ProjectionUnavailable => return error.ProjectionUnavailable,
            error.CorruptProjection => return error.CorruptProjection,
            error.RevisionConflict => return error.RevisionConflict,
            error.InvalidSnapshot, error.DuplicateRecord => return .invalid_repository,
        };
        return switch (result) {
            .applied => .applied,
            .idempotent => .idempotent,
            .stale => .stale,
        };
    }
};

fn verifyFetchedImpl(
    self: Projector,
    allocator: std.mem.Allocator,
    fetched: repository_source.Repo,
    did: []const u8,
    public_key: zat.multicodec.PublicKey,
    indexed_at_us: i64,
) !verified_snapshot.Snapshot {
    if (fetched.proofs) |proofs| return snapshot_verifier.verifyProofs(
        allocator,
        proofs,
        fetched.paths orelse return error.InvalidSnapshot,
        did,
        public_key,
        self.list_collection,
        self.track_collection,
        self.profile_collection,
        self.like_collection,
        indexed_at_us,
    );
    return snapshot_verifier.verify(
        allocator,
        fetched.bytes,
        did,
        public_key,
        self.list_collection,
        self.track_collection,
        self.profile_collection,
        self.like_collection,
        indexed_at_us,
    );
}

pub const RepairOutcome = enum {
    applied,
    idempotent,
    stale,
    not_found,
    rate_limited,
    unavailable,
    too_large,
    endpoint_missing,
    unsafe_endpoint,
    unsupported_endpoint,
    unverified_identity,
    invalid_signature,
    invalid_repository,
};

pub const Error = error{
    OutOfMemory,
    ProjectionUnavailable,
    CorruptProjection,
    RevisionConflict,
};

fn classifySnapshotVerification(err: anyerror) Error!RepairOutcome {
    if (err == error.OutOfMemory) return error.OutOfMemory;
    return switch (err) {
        error.SignatureVerificationFailed => .invalid_signature,
        error.RepositoryTooLarge => .too_large,
        else => .invalid_repository,
    };
}

test "repair releases an invalid fetched repository without projecting it" {
    const Fixture = struct {
        released: bool = false,

        fn key(
            _: *anyopaque,
            allocator: std.mem.Allocator,
            _: []const u8,
            _: bool,
        ) signing_key.Error!signing_key.Key {
            return .{ .key_type = .p256, .raw = try allocator.dupe(u8, "x") };
        }

        fn repo(
            context: *anyopaque,
            _: std.mem.Allocator,
            _: []const u8,
        ) repository_source.Error!repository_source.Repo {
            return .{
                .bytes = "not a car",
                .release_context = context,
                .release_fn = release,
            };
        }

        fn release(context: *anyopaque, _: []const u8) void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.released = true;
        }

        fn head(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: []const u8,
        ) repository_head.Error!?repository_head.Head {
            return null;
        }

        fn commit(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: verified_commit.Commit,
        ) verified_commit.Error!verified_commit.ApplyResult {
            return error.ProjectionUnavailable;
        }

        fn snapshot(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: verified_snapshot.Snapshot,
        ) verified_snapshot.Error!verified_snapshot.ApplyResult {
            return error.ProjectionUnavailable;
        }
    };
    var fixture: Fixture = .{};
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const projector: Projector = .{
        .heads = .{ .context = &fixture, .load_fn = Fixture.head },
        .commits = .{ .context = &fixture, .apply_fn = Fixture.commit },
        .snapshots = .{ .context = &fixture, .apply_fn = Fixture.snapshot },
        .keys = .{ .context = &fixture, .resolve_fn = Fixture.key },
        .repositories = .{ .context = &fixture, .fetch_fn = Fixture.repo },
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .like_collection = "fm.plyr.dev.like",
    };
    try std.testing.expectEqual(
        RepairOutcome.invalid_repository,
        try projector.repair(arena.allocator(), "did:plc:a", 1),
    );
    try std.testing.expect(fixture.released);
}

test "repair refreshes a rotated signing key before one atomic snapshot apply" {
    const Fixture = struct {
        car_bytes: []const u8,
        wrong_key: []const u8,
        correct_key: []const u8,
        resolves: usize = 0,
        releases: usize = 0,
        applies: usize = 0,
        saw_empty_snapshot: bool = false,

        fn key(
            context: *anyopaque,
            _: std.mem.Allocator,
            _: []const u8,
            refresh: bool,
        ) signing_key.Error!signing_key.Key {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.resolves += 1;
            return .{
                .key_type = .p256,
                .raw = if (refresh) self.correct_key else self.wrong_key,
            };
        }

        fn repo(
            context: *anyopaque,
            _: std.mem.Allocator,
            _: []const u8,
        ) repository_source.Error!repository_source.Repo {
            const self: *@This() = @ptrCast(@alignCast(context));
            return .{
                .bytes = self.car_bytes,
                .release_context = context,
                .release_fn = release,
            };
        }

        fn release(context: *anyopaque, _: []const u8) void {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.releases += 1;
        }

        fn snapshot(
            context: *anyopaque,
            _: std.mem.Allocator,
            value: verified_snapshot.Snapshot,
        ) verified_snapshot.Error!verified_snapshot.ApplyResult {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.saw_empty_snapshot = value.list_changes.len == 0;
            self.applies += 1;
            return .applied;
        }

        fn head(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: []const u8,
        ) repository_head.Error!?repository_head.Head {
            return null;
        }

        fn commit(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: verified_commit.Commit,
        ) verified_commit.Error!verified_commit.ApplyResult {
            return error.ProjectionUnavailable;
        }
    };

    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const keypair = try zat.Keypair.fromSecretKey(.p256, @as([32]u8, @splat(41)));
    const wrong_keypair = try zat.Keypair.fromSecretKey(.p256, @as([32]u8, @splat(43)));
    const did = try keypair.did(a);
    const correct_key_array = try keypair.publicKey();
    const wrong_key_array = try wrong_keypair.publicKey();
    var tree = zat.mst.Mst.init(a);
    const data_cid = try tree.rootCid();
    const signed = try zat.signCommit(a, .{
        .did = did,
        .rev = "3jqfcqzm3fo2j",
        .data = data_cid,
    }, &keypair);
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    try blocks.append(a, .{ .cid_raw = signed.cid.raw, .data = signed.bytes });
    try tree.collectBlocks(&blocks);
    var fixture: Fixture = .{
        .car_bytes = try zat.car.writeAlloc(a, .{
            .roots = &.{signed.cid},
            .blocks = blocks.items,
        }),
        .wrong_key = &wrong_key_array,
        .correct_key = &correct_key_array,
    };
    const projector: Projector = .{
        .heads = .{ .context = &fixture, .load_fn = Fixture.head },
        .commits = .{ .context = &fixture, .apply_fn = Fixture.commit },
        .snapshots = .{ .context = &fixture, .apply_fn = Fixture.snapshot },
        .keys = .{ .context = &fixture, .resolve_fn = Fixture.key },
        .repositories = .{ .context = &fixture, .fetch_fn = Fixture.repo },
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .like_collection = "fm.plyr.dev.like",
    };
    try std.testing.expectEqual(
        RepairOutcome.applied,
        try projector.repair(a, did, 1),
    );
    try std.testing.expectEqual(@as(usize, 2), fixture.resolves);
    try std.testing.expectEqual(@as(usize, 1), fixture.releases);
    try std.testing.expectEqual(@as(usize, 1), fixture.applies);
    try std.testing.expect(fixture.saw_empty_snapshot);
}
