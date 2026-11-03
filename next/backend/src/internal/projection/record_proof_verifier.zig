//! Authenticate `sync.getRecord` proofs: single records for live ingestion,
//! and bundles for repositories too large to fetch whole (producing the same
//! verified snapshot as a full repo CAR).

const std = @import("std");
const zat = @import("zat");
const snapshot_verifier = @import("snapshot_verifier.zig");
const verified = @import("verified_snapshot.zig");

/// Per-record proofs bounded like a snapshot of one repository.
pub const max_proof_records = 2000;
const max_proof_bytes = 4 * 1024 * 1024;

/// Authenticate a bundle of `com.atproto.sync.getRecord` proofs taken at one
/// commit and extract the selected records, for repositories too large to
/// snapshot whole. Every proof must share the signed commit; each listed path
/// is looked up through the proven MST nodes, so a record is only admitted
/// with a hash-linked path from the signed root. A path the tree doesn't hold
/// is treated as deleted between listing and proving.
pub fn verifyProofs(
    allocator: std.mem.Allocator,
    proofs: []const []const u8,
    paths: []const []const u8,
    expected_did: []const u8,
    public_key: zat.multicodec.PublicKey,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    indexed_at_us: i64,
) !verified.Snapshot {
    if (proofs.len == 0 or proofs.len != paths.len or proofs.len > max_proof_records)
        return error.InvalidSnapshot;
    if (zat.Did.parse(expected_did) == null or indexed_at_us < 0) return error.InvalidSnapshot;

    const cars = try allocator.alloc(zat.car.Car, proofs.len);
    for (proofs, 0..) |bytes, index| {
        cars[index] = zat.car.readWithOptions(allocator, bytes, .{
            .max_size = max_proof_bytes,
            .max_blocks = 1024,
        }) catch return error.InvalidSnapshot;
        if (cars[index].roots.len != 1 or
            !std.mem.eql(u8, cars[index].roots[0].raw, cars[0].roots[0].raw))
            return error.InvalidSnapshot;
    }
    const commit = try signedCommit(allocator, cars, proofs[0], expected_did, public_key);
    const commit_cid = commit.cid;
    const commit_rev = commit.rev;
    const data_cid = commit.data;

    var blocks: CarBlocks = .{ .cars = cars };
    var tree = try zat.mst.Mst.loadLazy(allocator, data_cid.raw, blocks.reader());
    var collector: snapshot_verifier.Collector = .{
        .allocator = allocator,
        .cars = cars,
        .repo_did = expected_did,
        .list_collection = list_collection,
        .track_collection = track_collection,
        .profile_collection = profile_collection,
        .like_collection = like_collection,
        .proof = .{ .commit_cid = commit_cid, .commit_rev = commit_rev, .indexed_at_us = indexed_at_us },
    };
    for (paths, 0..) |path, index| {
        for (paths[0..index]) |earlier| if (std.mem.eql(u8, earlier, path)) return error.InvalidSnapshot;
        const value = (tree.getLazy(path) catch return error.IncompleteRepo) orelse continue;
        try snapshot_verifier.Collector.entry(&collector, .{ .key = path, .value = value });
    }
    const snapshot: verified.Snapshot = .{
        .repo_did = expected_did,
        .commit_rev = commit_rev,
        .commit_cid = commit_cid,
        .data_cid = data_cid,
        .list_collection = list_collection,
        .track_collection = track_collection,
        .profile_collection = profile_collection,
        .like_collection = like_collection,
        .indexed_at_us = indexed_at_us,
        .list_changes = try collector.changes.toOwnedSlice(allocator),
        .track_changes = try collector.track_changes.toOwnedSlice(allocator),
        .profile_changes = try collector.profile_changes.toOwnedSlice(allocator),
        .like_changes = try collector.like_changes.toOwnedSlice(allocator),
        .rejections = try collector.rejections.toOwnedSlice(allocator),
    };
    try snapshot.validate();
    return snapshot;
}

const SignedCommit = struct {
    cid: zat.Cid,
    rev: []const u8,
    data: zat.Cid,
};

/// Check the commit block every proof shares: signed by the repo key, version
/// 3, for the expected DID, with a valid rev.
fn signedCommit(
    allocator: std.mem.Allocator,
    cars: []const zat.car.Car,
    first_proof: []const u8,
    expected_did: []const u8,
    public_key: zat.multicodec.PublicKey,
) !SignedCommit {
    {
        var proof_arena = std.heap.ArenaAllocator.init(allocator);
        defer proof_arena.deinit();
        _ = try zat.verifyCommitCar(proof_arena.allocator(), first_proof, public_key, .{
            .expected_did = expected_did,
            .verify_mst = false,
            .max_car_size = max_proof_bytes,
            .max_blocks = 1024,
        });
    }
    const commit_cid = cars[0].roots[0];
    const commit_bytes = zat.car.findBlock(cars[0], commit_cid.raw) orelse return error.InvalidSnapshot;
    const commit_value = zat.cbor.decodeAll(allocator, commit_bytes) catch return error.InvalidSnapshot;
    const commit_did = commit_value.getString("did") orelse return error.InvalidSnapshot;
    const commit_rev = commit_value.getString("rev") orelse return error.InvalidSnapshot;
    const commit_version = commit_value.getInt("version") orelse return error.InvalidSnapshot;
    const data_cid = switch (commit_value.get("data") orelse return error.InvalidSnapshot) {
        .cid => |value| value,
        else => return error.InvalidSnapshot,
    };
    if (commit_version != 3 or !std.mem.eql(u8, commit_did, expected_did) or
        zat.Tid.parse(commit_rev) == null) return error.InvalidSnapshot;
    return .{ .cid = commit_cid, .rev = commit_rev, .data = data_cid };
}

/// One record's state at a signed commit, from its `sync.getRecord` proof.
pub const RecordState = struct {
    commit_cid: zat.Cid,
    commit_rev: []const u8,
    /// null when the proven tree has no such path (the record is deleted).
    record: ?struct { cid: zat.Cid, value: zat.cbor.Value },
};

/// Authenticate one `sync.getRecord` proof for `path`: the commit is signed by
/// the repo key, the MST path to `path` hash-links to that commit, and the
/// record block hashes to the CID the tree holds. Absence is proven the same
/// way, by the tree nodes that would hold the path.
pub fn verifyRecord(
    allocator: std.mem.Allocator,
    proof: []const u8,
    path: []const u8,
    expected_did: []const u8,
    public_key: zat.multicodec.PublicKey,
) !RecordState {
    if (zat.Did.parse(expected_did) == null) return error.InvalidSnapshot;
    const cars = try allocator.alloc(zat.car.Car, 1);
    cars[0] = zat.car.readWithOptions(allocator, proof, .{
        .max_size = max_proof_bytes,
        .max_blocks = 1024,
    }) catch return error.InvalidSnapshot;
    if (cars[0].roots.len != 1) return error.InvalidSnapshot;
    const commit = try signedCommit(allocator, cars, proof, expected_did, public_key);
    var blocks: CarBlocks = .{ .cars = cars };
    var tree = try zat.mst.Mst.loadLazy(allocator, commit.data.raw, blocks.reader());
    const value_cid = (tree.getLazy(path) catch return error.IncompleteRepo) orelse
        return .{ .commit_cid = commit.cid, .commit_rev = commit.rev, .record = null };
    const bytes = zat.car.findBlock(cars[0], value_cid.raw) orelse return error.IncompleteRepo;
    const value = zat.cbor.decodeAll(allocator, bytes) catch return error.InvalidRecord;
    return .{
        .commit_cid = commit.cid,
        .commit_rev = commit.rev,
        .record = .{ .cid = value_cid, .value = value },
    };
}

const CarBlocks = struct {
    cars: []const zat.car.Car,

    fn reader(self: *CarBlocks) zat.mst.BlockReader {
        return .{ .ctx = self, .getFn = get };
    }

    fn get(context: *anyopaque, cid_raw: []const u8) anyerror!?[]const u8 {
        const self: *CarBlocks = @ptrCast(@alignCast(context));
        return snapshot_verifier.findInCars(self.cars, cid_raw);
    }
};

test "record proofs authenticate listed paths through the signed commit" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const fixture = try snapshot_verifier.buildFixture(a, true, false);
    const full = try snapshot_verifier.verify(a, fixture.car_bytes, fixture.did, fixture.public_key, "fm.plyr.dev.list", "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", 42);
    const track_path = try std.fmt.allocPrint(a, "fm.plyr.dev.track/{s}", .{full.track_changes[0].upsert.rkey});
    // a full repo CAR is a valid (oversized) proof for any of its paths
    const snapshot = try verifyProofs(
        a,
        &.{ fixture.car_bytes, fixture.car_bytes },
        &.{ track_path, "fm.plyr.dev.track/3zzzzzzzzzzzz" },
        fixture.did,
        fixture.public_key,
        "fm.plyr.dev.list",
        "fm.plyr.dev.track",
        "fm.plyr.dev.actor.profile",
        "fm.plyr.dev.like",
        42,
    );
    try std.testing.expectEqual(@as(usize, 1), snapshot.track_changes.len);
    try std.testing.expectEqual(@as(usize, 0), snapshot.list_changes.len);
    try std.testing.expectEqualStrings(full.commit_rev, snapshot.commit_rev);
    try std.testing.expectError(error.InvalidSnapshot, verifyProofs(a, &.{fixture.car_bytes}, &.{ track_path, track_path }, fixture.did, fixture.public_key, "fm.plyr.dev.list", "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", 42));
}

test "a single record proof yields the record, or proven absence, at the signed commit" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const fixture = try snapshot_verifier.buildFixture(a, true, false);
    const full = try snapshot_verifier.verify(a, fixture.car_bytes, fixture.did, fixture.public_key, "fm.plyr.dev.list", "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", 42);
    const track_path = try std.fmt.allocPrint(a, "fm.plyr.dev.track/{s}", .{full.track_changes[0].upsert.rkey});
    const present = try verifyRecord(a, fixture.car_bytes, track_path, fixture.did, fixture.public_key);
    try std.testing.expectEqualStrings(full.commit_rev, present.commit_rev);
    try std.testing.expectEqualStrings("Verified", present.record.?.value.getString("title").?);
    const absent = try verifyRecord(a, fixture.car_bytes, "fm.plyr.dev.track/3zzzzzzzzzzzz", fixture.did, fixture.public_key);
    try std.testing.expect(absent.record == null);
    const other = try zat.Keypair.fromSecretKey(.p256, @as([32]u8, @splat(99)));
    const other_key = try other.publicKey();
    try std.testing.expectError(error.SignatureVerificationFailed, verifyRecord(a, fixture.car_bytes, track_path, fixture.did, .{ .key_type = .p256, .raw = &other_key }));
}
