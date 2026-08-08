//! Schema-independent projection command derived from a verified repo op.
//!
//! Callers must first verify the firehose commit with `zat.verifyCommitDiff`.
//! That proof connects the signed commit, MST operation, record CID, and CAR
//! block. This module then converts the verified record into one atomic
//! upsert/delete command without depending on a Postgres table layout.

const std = @import("std");
const zat = @import("zat");
const list_record = @import("../atproto/list_record.zig");

pub const Proof = struct {
    commit_cid: zat.Cid,
    commit_rev: []const u8,
    indexed_at_us: i64,
};

pub const Member = struct {
    position: u16,
    track_uri: []const u8,
    track_cid: []const u8,
};

pub const Upsert = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    list_type: list_record.ListType,
    name: ?[]const u8,
    created_at: []const u8,
    updated_at: ?[]const u8,
    members: []Member,
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

pub const Error = list_record.Error || error{
    InvalidOperation,
    InvalidIdentity,
};

pub fn fromVerifiedOperation(
    allocator: std.mem.Allocator,
    repo_did: []const u8,
    op: zat.firehose.RepoOp,
    list_collection: []const u8,
    track_collection: []const u8,
    proof: Proof,
) Error!?Change {
    if (!std.mem.eql(u8, op.collection, list_collection)) return null;
    if (zat.Did.parse(repo_did) == null or zat.Rkey.parse(op.rkey) == null)
        return error.InvalidIdentity;
    try validateProof(proof);
    if (op.path.len != 0) {
        const expected_path = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ list_collection, op.rkey });
        if (!std.mem.eql(u8, op.path, expected_path)) return error.InvalidIdentity;
    }

    const record_uri = try std.fmt.allocPrint(
        allocator,
        "at://{s}/{s}/{s}",
        .{ repo_did, list_collection, op.rkey },
    );

    if (op.action == .delete) {
        const previous = op.prev orelse return error.InvalidOperation;
        if (op.cid != null or op.record != null) return error.InvalidOperation;
        try validateDagCborCid(previous);
        return .{ .delete = .{
            .record_uri = record_uri,
            .owner_did = repo_did,
            .collection = list_collection,
            .rkey = op.rkey,
            .proof = proof,
        } };
    }

    const cid = op.cid orelse return error.InvalidOperation;
    const record_value = op.record orelse return error.InvalidOperation;
    switch (op.action) {
        .create => if (op.prev != null) return error.InvalidOperation,
        .update => {
            const previous = op.prev orelse return error.InvalidOperation;
            try validateDagCborCid(previous);
        },
        .delete => unreachable,
    }
    try validateDagCborCid(cid);
    const parsed = try list_record.parse(allocator, record_value, list_collection, track_collection);

    const members = try allocator.alloc(Member, parsed.items.len);
    for (parsed.items, members, 0..) |item, *member, index| {
        member.* = .{
            .position = @intCast(index),
            .track_uri = item.uri,
            .track_cid = try item.cid.toString(allocator),
        };
    }

    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = try cid.toString(allocator),
        .owner_did = repo_did,
        .collection = list_collection,
        .rkey = op.rkey,
        .list_type = parsed.list_type,
        .name = parsed.name,
        .created_at = parsed.created_at,
        .updated_at = parsed.updated_at,
        .members = members,
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

test "verified list upsert is atomic, ordered, and schema independent" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const track_cid = try zat.Cid.forDagCbor(a, "track");
    const record_cid = try zat.Cid.forDagCbor(a, "list");
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const subject: zat.cbor.Value = .{ .map = &.{
        .{ .key = "uri", .value = .{ .text = "at://did:plc:artist/fm.plyr.dev.track/t" } },
        .{ .key = "cid", .value = .{ .cid = track_cid } },
    } };
    const items = [_]zat.cbor.Value{.{ .map = &.{
        .{ .key = "subject", .value = subject },
    } }};
    const record: zat.cbor.Value = .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.list" } },
        .{ .key = "listType", .value = .{ .text = "album" } },
        .{ .key = "items", .value = .{ .array = &items } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
    } };
    const change = (try fromVerifiedOperation(
        a,
        "did:plc:artist",
        .{
            .action = .create,
            .path = "fm.plyr.dev.list/3m123abc",
            .collection = "fm.plyr.dev.list",
            .rkey = "3m123abc",
            .cid = record_cid,
            .record = record,
        },
        "fm.plyr.dev.list",
        "fm.plyr.dev.track",
        .{ .commit_cid = commit_cid, .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 42 },
    )).?.upsert;

    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.list/3m123abc",
        change.record_uri,
    );
    try std.testing.expectEqual(@as(usize, 1), change.members.len);
    try std.testing.expectEqual(@as(u16, 0), change.members[0].position);
    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.track/t",
        change.members[0].track_uri,
    );
    try std.testing.expectEqual(@as(i64, 42), change.proof.indexed_at_us);
}

test "verified list delete carries identity and proof without stale members" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const previous = try zat.Cid.forDagCbor(a, "previous");
    const commit = try zat.Cid.forDagCbor(a, "commit");

    const change = (try fromVerifiedOperation(
        a,
        "did:plc:artist",
        .{
            .action = .delete,
            .path = "fm.plyr.dev.list/3m123abc",
            .collection = "fm.plyr.dev.list",
            .rkey = "3m123abc",
            .prev = previous,
        },
        "fm.plyr.dev.list",
        "fm.plyr.dev.track",
        .{ .commit_cid = commit, .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 42 },
    )).?.delete;

    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.list/3m123abc",
        change.record_uri,
    );
    try std.testing.expectEqualStrings("3jqfcqzm3fo2j", change.proof.commit_rev);
}

test "projection rejects operation shapes and provenance not established by verification" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const previous = try zat.Cid.forDagCbor(a, "previous");
    const commit = try zat.Cid.forDagCbor(a, "commit");
    const malformed_delete: zat.firehose.RepoOp = .{
        .action = .delete,
        .path = "fm.plyr.dev.list/3m123abc",
        .collection = "fm.plyr.dev.list",
        .rkey = "3m123abc",
    };

    try std.testing.expectError(
        error.InvalidOperation,
        fromVerifiedOperation(
            a,
            "did:plc:artist",
            malformed_delete,
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            .{ .commit_cid = commit, .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 42 },
        ),
    );

    const valid_delete: zat.firehose.RepoOp = .{
        .action = .delete,
        .path = "fm.plyr.dev.list/3m123abc",
        .collection = "fm.plyr.dev.list",
        .rkey = "3m123abc",
        .prev = previous,
    };
    try std.testing.expectError(
        error.InvalidOperation,
        fromVerifiedOperation(
            a,
            "did:plc:artist",
            valid_delete,
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            .{ .commit_cid = commit, .commit_rev = "not-a-tid", .indexed_at_us = 42 },
        ),
    );
}
