//! Schema-independent projection command for a verified profile repository op.

const std = @import("std");
const zat = @import("zat");
const profile_record = @import("../atproto/profile_record.zig");
const list_change = @import("list_change.zig");

pub const Proof = list_change.Proof;

pub const Upsert = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    avatar: ?[]const u8,
    bio: ?[]const u8,
    created_at: []const u8,
    updated_at: ?[]const u8,
    proof: Proof,
};

pub const Delete = struct {
    record_uri: []const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    proof: Proof,
};

pub const Change = union(enum) {
    upsert: Upsert,
    delete: Delete,
};

pub const Error = profile_record.Error || error{
    InvalidOperation,
    InvalidIdentity,
    OutOfMemory,
};

pub fn fromVerifiedOperation(
    allocator: std.mem.Allocator,
    repo_did: []const u8,
    op: zat.firehose.RepoOp,
    profile_collection: []const u8,
    proof: Proof,
) Error!?Change {
    if (!std.mem.eql(u8, op.collection, profile_collection)) return null;
    if (zat.Did.parse(repo_did) == null or !std.mem.eql(u8, op.rkey, "self"))
        return error.InvalidIdentity;
    try validateProof(proof);
    if (op.path.len != 0) {
        const expected = try std.fmt.allocPrint(allocator, "{s}/self", .{profile_collection});
        if (!std.mem.eql(u8, op.path, expected)) return error.InvalidIdentity;
    }
    const record_uri = try std.fmt.allocPrint(
        allocator,
        "at://{s}/{s}/self",
        .{ repo_did, profile_collection },
    );

    if (op.action == .delete) {
        const previous = op.prev orelse return error.InvalidOperation;
        if (op.cid != null or op.record != null) return error.InvalidOperation;
        try validateDagCborCid(previous);
        return .{ .delete = .{
            .record_uri = record_uri,
            .owner_did = repo_did,
            .collection = profile_collection,
            .rkey = "self",
            .proof = proof,
        } };
    }

    const cid = op.cid orelse return error.InvalidOperation;
    const value = op.record orelse return error.InvalidOperation;
    switch (op.action) {
        .create => if (op.prev != null) return error.InvalidOperation,
        .update => {
            const previous = op.prev orelse return error.InvalidOperation;
            try validateDagCborCid(previous);
        },
        .delete => unreachable,
    }
    try validateDagCborCid(cid);
    const parsed = try profile_record.parse(value, profile_collection);
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = try cid.toString(allocator),
        .owner_did = repo_did,
        .collection = profile_collection,
        .rkey = "self",
        .avatar = parsed.avatar,
        .bio = parsed.bio,
        .created_at = parsed.created_at,
        .updated_at = parsed.updated_at,
        .proof = proof,
    } };
}

fn validateProof(proof: Proof) Error!void {
    if (zat.Tid.parse(proof.commit_rev) == null or proof.indexed_at_us < 0)
        return error.InvalidOperation;
    try validateDagCborCid(proof.commit_cid);
}

fn validateDagCborCid(cid: zat.Cid) Error!void {
    const parsed = zat.Cid.fromBytes(cid.raw) catch return error.InvalidOperation;
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidOperation;
}

test "verified profile operation requires the literal self key" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record_cid = try zat.Cid.forDagCbor(a, "profile");
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.actor.profile" } },
        .{ .key = "bio", .value = .{ .text = "artist bio" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const proof: Proof = .{
        .commit_cid = commit_cid,
        .commit_rev = "3jqfcqzm3fo2j",
        .indexed_at_us = 42,
    };
    const change = (try fromVerifiedOperation(a, "did:plc:artist", .{
        .action = .create,
        .path = "fm.plyr.dev.actor.profile/self",
        .collection = "fm.plyr.dev.actor.profile",
        .rkey = "self",
        .cid = record_cid,
        .record = record,
    }, "fm.plyr.dev.actor.profile", proof)).?.upsert;
    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.actor.profile/self",
        change.record_uri,
    );
    try std.testing.expectEqualStrings("artist bio", change.bio.?);

    try std.testing.expectError(error.InvalidIdentity, fromVerifiedOperation(
        a,
        "did:plc:artist",
        .{
            .action = .create,
            .path = "fm.plyr.dev.actor.profile/other",
            .collection = "fm.plyr.dev.actor.profile",
            .rkey = "other",
            .cid = record_cid,
            .record = record,
        },
        "fm.plyr.dev.actor.profile",
        proof,
    ));
}
