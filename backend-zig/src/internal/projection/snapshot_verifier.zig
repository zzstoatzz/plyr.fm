//! Authenticate and extract a complete `com.atproto.sync.getRepo` snapshot.

const std = @import("std");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const verified = @import("verified_snapshot.zig");

pub const max_repo_bytes = 64 * 1024 * 1024;
pub const max_repo_blocks = 250_000;

pub fn verify(
    allocator: std.mem.Allocator,
    car_bytes: []const u8,
    expected_did: []const u8,
    public_key: zat.multicodec.PublicKey,
    list_collection: []const u8,
    track_collection: []const u8,
    indexed_at_us: i64,
) !verified.Snapshot {
    if (car_bytes.len > max_repo_bytes) return error.RepositoryTooLarge;
    if (zat.Did.parse(expected_did) == null or
        zat.Nsid.parse(list_collection) == null or
        zat.Nsid.parse(track_collection) == null or
        indexed_at_us < 0) return error.InvalidSnapshot;

    // The specialized Zat verifier proves signature, block hashes, MST layer
    // structure, and presence of every referenced record. Its allocations are
    // released before the retained parse used for extraction.
    {
        var proof_arena = std.heap.ArenaAllocator.init(allocator);
        defer proof_arena.deinit();
        const proof = try zat.verifyCommitCar(
            proof_arena.allocator(),
            car_bytes,
            public_key,
            .{
                .expected_did = expected_did,
                .require_complete_repo = true,
                .max_car_size = max_repo_bytes,
                .max_blocks = max_repo_blocks,
            },
        );
        if (zat.Tid.parse(proof.commit_rev) == null) return error.InvalidSnapshot;
    }

    // `loadCommitFromCAR` intentionally retains the 2 MB live-diff default.
    // A complete repo uses the configurable reader directly after the proof
    // pass so this path's larger, still-bounded limit is real.
    const repo_car = try zat.car.readWithOptions(allocator, car_bytes, .{
        .max_size = max_repo_bytes,
        .max_blocks = max_repo_blocks,
    });
    if (repo_car.roots.len != 1) return error.InvalidSnapshot;
    const commit_cid = repo_car.roots[0];
    const commit_bytes = zat.car.findBlock(repo_car, commit_cid.raw) orelse
        return error.InvalidSnapshot;
    const commit_value = zat.cbor.decodeAll(allocator, commit_bytes) catch
        return error.InvalidSnapshot;
    const commit_did = commit_value.getString("did") orelse return error.InvalidSnapshot;
    const commit_rev = commit_value.getString("rev") orelse return error.InvalidSnapshot;
    const commit_version = commit_value.getInt("version") orelse return error.InvalidSnapshot;
    const data_value = commit_value.get("data") orelse return error.InvalidSnapshot;
    const data_cid = switch (data_value) {
        .cid => |value| value,
        else => return error.InvalidSnapshot,
    };
    if (commit_version != 3 or
        !std.mem.eql(u8, commit_did, expected_did) or
        zat.Tid.parse(commit_rev) == null) return error.InvalidSnapshot;
    var tree = try zat.mst.Mst.loadFromBlocks(
        allocator,
        repo_car,
        data_cid.raw,
    );
    var collector: Collector = .{
        .allocator = allocator,
        .repo_car = repo_car,
        .repo_did = expected_did,
        .list_collection = list_collection,
        .track_collection = track_collection,
        .proof = .{
            .commit_cid = commit_cid,
            .commit_rev = commit_rev,
            .indexed_at_us = indexed_at_us,
        },
    };
    try tree.walk(.{ .ctx = &collector, .entryFn = Collector.entry });
    const snapshot: verified.Snapshot = .{
        .repo_did = expected_did,
        .commit_rev = commit_rev,
        .commit_cid = collector.proof.commit_cid,
        .data_cid = data_cid,
        .list_collection = list_collection,
        .indexed_at_us = indexed_at_us,
        .list_changes = try collector.changes.toOwnedSlice(allocator),
    };
    try snapshot.validate();
    return snapshot;
}

const Collector = struct {
    allocator: std.mem.Allocator,
    repo_car: zat.car.Car,
    repo_did: []const u8,
    list_collection: []const u8,
    track_collection: []const u8,
    proof: list_change.Proof,
    changes: std.ArrayList(list_change.Change) = .empty,

    fn entry(context: *anyopaque, item: zat.mst.WalkEntry) anyerror!void {
        const self: *Collector = @ptrCast(@alignCast(context));
        const separator = std.mem.indexOfScalar(u8, item.key, '/') orelse
            return error.InvalidRepoPath;
        if (std.mem.indexOfScalar(u8, item.key[separator + 1 ..], '/') != null)
            return error.InvalidRepoPath;
        const collection = item.key[0..separator];
        if (!std.mem.eql(u8, collection, self.list_collection)) return;
        const rkey = item.key[separator + 1 ..];
        if (zat.Rkey.parse(rkey) == null) return error.InvalidRepoPath;
        const record_bytes = zat.car.findBlock(self.repo_car, item.value.raw) orelse
            return error.IncompleteRepo;
        const record = zat.cbor.decodeAll(self.allocator, record_bytes) catch
            return error.InvalidListRecord;
        const change = (try list_change.fromVerifiedOperation(
            self.allocator,
            self.repo_did,
            .{
                .action = .create,
                .path = item.key,
                .collection = collection,
                .rkey = rkey,
                .cid = item.value,
                .record = record,
            },
            self.list_collection,
            self.track_collection,
            self.proof,
        )) orelse return error.InvalidListRecord;
        try self.changes.append(self.allocator, change);
    }
};

test "complete repo verifier authenticates and extracts list records" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const fixture = try buildFixture(a, true);
    const snapshot = try verify(
        a,
        fixture.car_bytes,
        fixture.did,
        fixture.public_key,
        "fm.plyr.dev.list",
        "fm.plyr.dev.track",
        42,
    );
    try std.testing.expectEqual(@as(usize, 1), snapshot.list_changes.len);
    try std.testing.expectEqualStrings(fixture.did, snapshot.repo_did);
    try std.testing.expectEqualStrings("3jqfcqzm3fo2j", snapshot.commit_rev);

    const incomplete = try buildFixture(a, false);
    try std.testing.expectError(
        error.IncompleteRepo,
        verify(
            a,
            incomplete.car_bytes,
            incomplete.did,
            incomplete.public_key,
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            42,
        ),
    );
}

const Fixture = struct {
    car_bytes: []const u8,
    did: []const u8,
    public_key: zat.multicodec.PublicKey,
};

fn buildFixture(allocator: std.mem.Allocator, include_record: bool) !Fixture {
    const keypair = try zat.Keypair.fromSecretKey(.p256, .{23} ** 32);
    const did = try keypair.did(allocator);
    const public_key_bytes = try keypair.publicKey();
    const owned_key = try allocator.dupe(u8, &public_key_bytes);
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "items", .value = .{ .array = &.{} } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const record_bytes = try zat.cbor.encodeAlloc(allocator, record);
    const record_cid = try zat.Cid.forDagCbor(allocator, record_bytes);
    var tree = zat.mst.Mst.init(allocator);
    try tree.put("fm.plyr.dev.list/3m123abc", record_cid);
    const root = try tree.rootCid();
    const signed = try zat.signCommit(allocator, .{
        .did = did,
        .rev = "3jqfcqzm3fo2j",
        .data = root,
    }, &keypair);
    var blocks: std.ArrayList(zat.car.Block) = .empty;
    try blocks.append(allocator, .{ .cid_raw = signed.cid.raw, .data = signed.bytes });
    try tree.collectBlocks(&blocks);
    if (include_record)
        try blocks.append(allocator, .{ .cid_raw = record_cid.raw, .data = record_bytes });
    return .{
        .car_bytes = try zat.car.writeAlloc(allocator, .{
            .roots = &.{signed.cid},
            .blocks = blocks.items,
        }),
        .did = did,
        .public_key = .{ .key_type = .p256, .raw = owned_key },
    };
}
