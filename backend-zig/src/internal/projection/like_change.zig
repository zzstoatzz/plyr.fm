//! Schema-independent projection command for a verified like repository op.

const std = @import("std");
const zat = @import("zat");
const like_record = @import("../atproto/like_record.zig");
const list_change = @import("list_change.zig");

pub const Proof = list_change.Proof;

pub const Upsert = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    subject_uri: []const u8,
    subject_cid: []const u8,
    created_at: []const u8,
    proof: Proof,
};

pub const Delete = struct {
    record_uri: []const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    proof: Proof,
};

pub const Change = union(enum) { upsert: Upsert, delete: Delete };

pub const Error = like_record.Error || error{
    InvalidOperation,
    InvalidIdentity,
    OutOfMemory,
};

pub fn fromVerifiedOperation(
    allocator: std.mem.Allocator,
    repo_did: []const u8,
    op: zat.firehose.RepoOp,
    like_collection: []const u8,
    track_collection: []const u8,
    proof: Proof,
) Error!?Change {
    if (!std.mem.eql(u8, op.collection, like_collection)) return null;
    if (zat.Did.parse(repo_did) == null or zat.Rkey.parse(op.rkey) == null)
        return error.InvalidIdentity;
    try validateProof(proof);
    if (op.path.len != 0) {
        const expected = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ like_collection, op.rkey });
        if (!std.mem.eql(u8, op.path, expected)) return error.InvalidIdentity;
    }
    const record_uri = try std.fmt.allocPrint(
        allocator,
        "at://{s}/{s}/{s}",
        .{ repo_did, like_collection, op.rkey },
    );
    if (op.action == .delete) {
        const previous = op.prev orelse return error.InvalidOperation;
        if (op.cid != null or op.record != null) return error.InvalidOperation;
        try validateDagCborCid(previous);
        return .{ .delete = .{
            .record_uri = record_uri,
            .owner_did = repo_did,
            .collection = like_collection,
            .rkey = op.rkey,
            .proof = proof,
        } };
    }
    const cid = op.cid orelse return error.InvalidOperation;
    const value = op.record orelse return error.InvalidOperation;
    switch (op.action) {
        .create => if (op.prev != null) return error.InvalidOperation,
        .update => try validateDagCborCid(op.prev orelse return error.InvalidOperation),
        .delete => unreachable,
    }
    try validateDagCborCid(cid);
    const parsed = try like_record.parse(value, like_collection, track_collection);
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = try cid.toString(allocator),
        .owner_did = repo_did,
        .collection = like_collection,
        .rkey = op.rkey,
        .subject_uri = parsed.subject_uri,
        .subject_cid = try parsed.subject_cid.toString(allocator),
        .created_at = parsed.created_at,
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

test "verified like operation binds authored record and track identity" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record_cid = try zat.Cid.forDagCbor(a, "like");
    const track_cid = try zat.Cid.forDagCbor(a, "track");
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.like" } },
        .{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/one" } },
            .{ .key = "cid", .value = .{ .cid = track_cid } },
        } } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-09T12:00:00Z" } },
    } };
    const change = (try fromVerifiedOperation(a, "did:plc:listener", .{
        .action = .create,
        .path = "fm.plyr.dev.like/3m123abc",
        .collection = "fm.plyr.dev.like",
        .rkey = "3m123abc",
        .cid = record_cid,
        .record = record,
    }, "fm.plyr.dev.like", "fm.plyr.dev.track", .{
        .commit_cid = commit_cid,
        .commit_rev = "3jqfcqzm3fo2j",
        .indexed_at_us = 42,
    })).?.upsert;
    try std.testing.expectEqualStrings(
        "at://did:plc:listener/fm.plyr.dev.like/3m123abc",
        change.record_uri,
    );
    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.track/one",
        change.subject_uri,
    );
}
