//! Schema-independent projection command for a verified comment repository op.

const std = @import("std");
const zat = @import("zat");
const comment_record = @import("../atproto/comment_record.zig");
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
    text: []const u8,
    timestamp_ms: u64,
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

pub const Change = union(enum) { upsert: Upsert, delete: Delete };

pub const Error = comment_record.Error || error{
    InvalidOperation,
    InvalidIdentity,
    OutOfMemory,
};

pub fn fromVerifiedOperation(
    allocator: std.mem.Allocator,
    repo_did: []const u8,
    op: zat.firehose.RepoOp,
    comment_collection: []const u8,
    track_collection: []const u8,
    proof: Proof,
) Error!?Change {
    if (!std.mem.eql(u8, op.collection, comment_collection)) return null;
    if (zat.Did.parse(repo_did) == null or zat.Rkey.parse(op.rkey) == null)
        return error.InvalidIdentity;
    try validateProof(proof);
    if (op.path.len != 0) {
        const expected = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ comment_collection, op.rkey });
        if (!std.mem.eql(u8, op.path, expected)) return error.InvalidIdentity;
    }
    const record_uri = try std.fmt.allocPrint(
        allocator,
        "at://{s}/{s}/{s}",
        .{ repo_did, comment_collection, op.rkey },
    );
    if (op.action == .delete) {
        // jetstream deletes carry no prior CID; firehose deletes do.
        if (op.cid != null or op.record != null) return error.InvalidOperation;
        if (op.prev) |previous| try validateDagCborCid(previous);
        return .{ .delete = .{
            .record_uri = record_uri,
            .owner_did = repo_did,
            .collection = comment_collection,
            .rkey = op.rkey,
            .proof = proof,
        } };
    }
    const cid = op.cid orelse return error.InvalidOperation;
    const value = op.record orelse return error.InvalidOperation;
    switch (op.action) {
        .create => if (op.prev != null) return error.InvalidOperation,
        .update => if (op.prev) |previous| try validateDagCborCid(previous),
        .delete => unreachable,
    }
    try validateDagCborCid(cid);
    const parsed = try comment_record.parse(allocator, value, comment_collection, track_collection);
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = try cid.toString(allocator),
        .owner_did = repo_did,
        .collection = comment_collection,
        .rkey = op.rkey,
        .subject_uri = parsed.subject_uri,
        .subject_cid = try parsed.subject_cid.toString(allocator),
        .text = parsed.text,
        .timestamp_ms = parsed.timestamp_ms,
        .created_at = parsed.created_at,
        .updated_at = parsed.updated_at,
        .proof = proof,
    } };
}

fn validateProof(proof: Proof) Error!void {
    if (zat.Tid.parse(proof.commit_rev) == null or proof.indexed_at_us < 0)
        return error.InvalidOperation;
    if (proof.commit_cid) |commit_cid| try validateDagCborCid(commit_cid);
}

fn validateDagCborCid(cid: zat.Cid) Error!void {
    const parsed = zat.Cid.fromBytes(cid.raw) catch return error.InvalidOperation;
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidOperation;
}

test "verified comment operation binds authored record, track and position" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record_cid = try zat.Cid.forDagCbor(a, "comment");
    const track_cid = try zat.Cid.forDagCbor(a, "track");
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.comment" } },
        .{ .key = "subject", .value = .{ .map = &.{
            .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/one" } },
            .{ .key = "cid", .value = .{ .text = try track_cid.toString(a) } },
        } } },
        .{ .key = "text", .value = .{ .text = "the sax here" } },
        .{ .key = "timestampMs", .value = .{ .unsigned = 250_000 } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-09T12:00:00Z" } },
    } };
    const change = (try fromVerifiedOperation(a, "did:plc:listener", .{
        .action = .create,
        .path = "fm.plyr.dev.comment/3m123abc",
        .collection = "fm.plyr.dev.comment",
        .rkey = "3m123abc",
        .cid = record_cid,
        .record = record,
    }, "fm.plyr.dev.comment", "fm.plyr.dev.track", .{
        .commit_cid = commit_cid,
        .commit_rev = "3jqfcqzm3fo2j",
        .indexed_at_us = 42,
    })).?.upsert;
    try std.testing.expectEqualStrings(
        "at://did:plc:listener/fm.plyr.dev.comment/3m123abc",
        change.record_uri,
    );
    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.track/one",
        change.subject_uri,
    );
    try std.testing.expectEqual(@as(u64, 250_000), change.timestamp_ms);
    try std.testing.expectEqualStrings("the sax here", change.text);
}
