//! Durable exclusion evidence for an authenticated but malformed app record.
//!
//! Repository verification proves the record's identity and bytes. A rejection
//! says only that those bytes cannot produce the selected application model.

const std = @import("std");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const track_change = @import("track_change.zig");
const profile_change = @import("profile_change.zig");
const like_change = @import("like_change.zig");

pub const Reason = enum {
    invalid_dag_cbor,
    invalid_schema,
};

pub const Rejection = struct {
    record_uri: []const u8,
    record_cid: zat.Cid,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    reason: Reason,
    detail: []const u8,
    proof: list_change.Proof,

    pub fn validate(self: Rejection) Error!void {
        if (zat.Did.parse(self.owner_did) == null or
            zat.Nsid.parse(self.collection) == null or
            zat.Rkey.parse(self.rkey) == null or
            zat.Tid.parse(self.proof.commit_rev) == null or
            self.proof.indexed_at_us < 0 or
            self.detail.len == 0 or self.detail.len > 128) return error.InvalidRejection;
        const parsed_uri = zat.AtUri.parse(self.record_uri) orelse
            return error.InvalidRejection;
        if (!std.mem.eql(u8, parsed_uri.authority(), self.owner_did) or
            !std.mem.eql(u8, parsed_uri.collection() orelse return error.InvalidRejection, self.collection) or
            !std.mem.eql(u8, parsed_uri.rkey() orelse return error.InvalidRejection, self.rkey))
            return error.InvalidRejection;
        try validateDagCbor(self.record_cid);
        try validateDagCbor(self.proof.commit_cid);
    }

    pub fn listDelete(self: Rejection) list_change.Change {
        return .{ .delete = .{
            .record_uri = self.record_uri,
            .owner_did = self.owner_did,
            .collection = self.collection,
            .rkey = self.rkey,
            .proof = self.proof,
        } };
    }

    pub fn trackDelete(self: Rejection) track_change.Change {
        return .{ .delete = .{
            .record_uri = self.record_uri,
            .owner_did = self.owner_did,
            .collection = self.collection,
            .rkey = self.rkey,
            .proof = self.proof,
        } };
    }

    pub fn profileDelete(self: Rejection) profile_change.Change {
        return .{ .delete = .{
            .record_uri = self.record_uri,
            .owner_did = self.owner_did,
            .collection = self.collection,
            .rkey = self.rkey,
            .proof = self.proof,
        } };
    }

    pub fn likeDelete(self: Rejection) like_change.Change {
        return .{ .delete = .{
            .record_uri = self.record_uri,
            .owner_did = self.owner_did,
            .collection = self.collection,
            .rkey = self.rkey,
            .proof = self.proof,
        } };
    }
};

pub const Error = error{InvalidRejection};

pub fn init(
    allocator: std.mem.Allocator,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    record_cid: zat.Cid,
    reason: Reason,
    detail: []const u8,
    proof: list_change.Proof,
) !Rejection {
    const rejection: Rejection = .{
        .record_uri = try std.fmt.allocPrint(
            allocator,
            "at://{s}/{s}/{s}",
            .{ owner_did, collection, rkey },
        ),
        .record_cid = record_cid,
        .owner_did = owner_did,
        .collection = collection,
        .rkey = rkey,
        .reason = reason,
        .detail = detail,
        .proof = proof,
    };
    try rejection.validate();
    return rejection;
}

fn validateDagCbor(cid: zat.Cid) Error!void {
    const parsed = zat.Cid.fromBytes(cid.raw) catch return error.InvalidRejection;
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidRejection;
}

test "rejection binds one malformed record to authenticated commit evidence" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const record = try zat.Cid.forDagCbor(a, "record");
    const commit = try zat.Cid.forDagCbor(a, "commit");
    const rejection = try init(
        a,
        "did:plc:owner",
        "fm.plyr.dev.list",
        "record",
        record,
        .invalid_schema,
        "InvalidStrongRefCid",
        .{ .commit_cid = commit, .commit_rev = "3jqfcqzm3fo2j", .indexed_at_us = 1 },
    );
    try rejection.validate();
    try std.testing.expectEqualStrings(
        "at://did:plc:owner/fm.plyr.dev.list/record",
        rejection.record_uri,
    );
}
