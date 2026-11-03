//! Schema-independent projection command for a verified track repository op.

const std = @import("std");
const zat = @import("zat");
const track_record = @import("../atproto/track_record.zig");
const list_change = @import("list_change.zig");

pub const Proof = list_change.Proof;

pub const Blob = struct {
    cid: []const u8,
    media_type: []const u8,
    size: u64,
};

pub const Upsert = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    title: []const u8,
    artist_name: []const u8,
    file_type: []const u8,
    created_at: []const u8,
    audio_url: ?[]const u8,
    audio_blob: ?Blob,
    album: ?[]const u8,
    duration_seconds: ?u64,
    featured_dids: []const []const u8,
    image_url: ?[]const u8,
    support_gate_type: ?[]const u8,
    description: ?[]const u8,
    self_labels: []const []const u8,
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

pub const Error = track_record.Error || error{
    InvalidOperation,
    InvalidIdentity,
};

pub fn fromVerifiedOperation(
    allocator: std.mem.Allocator,
    repo_did: []const u8,
    op: zat.firehose.RepoOp,
    track_collection: []const u8,
    proof: Proof,
) Error!?Change {
    if (!std.mem.eql(u8, op.collection, track_collection)) return null;
    if (zat.Did.parse(repo_did) == null or zat.Rkey.parse(op.rkey) == null)
        return error.InvalidIdentity;
    try validateProof(proof);
    if (op.path.len != 0) {
        const expected = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ track_collection, op.rkey });
        if (!std.mem.eql(u8, op.path, expected)) return error.InvalidIdentity;
    }
    const record_uri = try std.fmt.allocPrint(
        allocator,
        "at://{s}/{s}/{s}",
        .{ repo_did, track_collection, op.rkey },
    );

    if (op.action == .delete) {
        const previous = op.prev orelse return error.InvalidOperation;
        if (op.cid != null or op.record != null) return error.InvalidOperation;
        try validateDagCborCid(previous);
        return .{ .delete = .{
            .record_uri = record_uri,
            .owner_did = repo_did,
            .collection = track_collection,
            .rkey = op.rkey,
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
    const parsed = try track_record.parse(allocator, value, track_collection);
    const audio_blob: ?Blob = if (parsed.audio_blob) |blob| .{
        .cid = try blob.cid.toString(allocator),
        .media_type = blob.media_type,
        .size = blob.size,
    } else null;
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = try cid.toString(allocator),
        .owner_did = repo_did,
        .collection = track_collection,
        .rkey = op.rkey,
        .title = parsed.title,
        .artist_name = parsed.artist_name,
        .file_type = parsed.file_type,
        .created_at = parsed.created_at,
        .audio_url = parsed.audio_url,
        .audio_blob = audio_blob,
        .album = parsed.album,
        .duration_seconds = parsed.duration_seconds,
        .featured_dids = parsed.featured_dids,
        .image_url = parsed.image_url,
        .support_gate_type = parsed.support_gate_type,
        .description = parsed.description,
        .self_labels = parsed.self_labels,
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

fn fixture(blob_cid: zat.Cid) zat.cbor.Value {
    return .{ .map = &.{
        .{ .key = "$type", .value = .{ .text = "fm.plyr.dev.track" } },
        .{ .key = "title", .value = .{ .text = "One" } },
        .{ .key = "artist", .value = .{ .text = "Artist" } },
        .{ .key = "fileType", .value = .{ .text = "flac" } },
        .{ .key = "createdAt", .value = .{ .text = "2026-08-08T12:00:00Z" } },
        .{ .key = "audioBlob", .value = .{ .map = &.{
            .{ .key = "$type", .value = .{ .text = "blob" } },
            .{ .key = "ref", .value = .{ .cid = blob_cid } },
            .{ .key = "mimeType", .value = .{ .text = "audio/flac" } },
            .{ .key = "size", .value = .{ .unsigned = 42 } },
        } } },
    } };
}

test "verified track operation becomes a complete source-authoritative upsert" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record_cid = try zat.Cid.forDagCbor(a, "record");
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    const blob_cid = try zat.Cid.create(a, 1, zat.cbor.Codec.raw, zat.cbor.HashFn.sha2_256, "audio");
    const change = (try fromVerifiedOperation(
        a,
        "did:plc:artist",
        .{
            .action = .create,
            .path = "fm.plyr.dev.track/3m123abc",
            .collection = "fm.plyr.dev.track",
            .rkey = "3m123abc",
            .cid = record_cid,
            .record = fixture(blob_cid),
        },
        "fm.plyr.dev.track",
        .{ .commit_cid = commit_cid, .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 42 },
    )).?.upsert;
    try std.testing.expectEqualStrings(
        "at://did:plc:artist/fm.plyr.dev.track/3m123abc",
        change.record_uri,
    );
    try std.testing.expectEqualStrings("One", change.title);
    try std.testing.expectEqualStrings(try blob_cid.toString(a), change.audio_blob.?.cid);
    try std.testing.expectEqual(@as(i64, 42), change.proof.indexed_at_us);
}

test "verified track delete requires the previous record CID" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commit_cid = try zat.Cid.forDagCbor(a, "commit");
    try std.testing.expectError(error.InvalidOperation, fromVerifiedOperation(
        a,
        "did:plc:artist",
        .{
            .action = .delete,
            .path = "fm.plyr.dev.track/3m123abc",
            .collection = "fm.plyr.dev.track",
            .rkey = "3m123abc",
        },
        "fm.plyr.dev.track",
        .{ .commit_cid = commit_cid, .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 42 },
    ));
}
